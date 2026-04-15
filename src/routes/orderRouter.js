const express = require('express');
const config = require('../config.js');
const { Role, DB } = require('../database/database.js');
const { authRouter } = require('./authRouter.js');
const { asyncHandler, StatusCodeError } = require('../endpointHelper.js');
const metrics = require('../metrics.js');
const logger = require('../logger.js');

const orderRouter = express.Router();

orderRouter.docs = [
  {
    method: 'GET',
    path: '/api/order/menu',
    description: 'Get the pizza menu',
    example: `curl localhost:3000/api/order/menu`,
    response: [{ id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' }],
  },
  {
    method: 'PUT',
    path: '/api/order/menu',
    requiresAuth: true,
    description: 'Add an item to the menu',
    example: `curl -X PUT localhost:3000/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Student", "description": "No topping, no sauce, just carbs", "image":"pizza9.png", "price": 0.0001 }'  -H 'Authorization: Bearer tttttt'`,
    response: [{ id: 1, title: 'Student', description: 'No topping, no sauce, just carbs', image: 'pizza9.png', price: 0.0001 }],
  },
  {
    method: 'GET',
    path: '/api/order',
    requiresAuth: true,
    description: 'Get the orders for the authenticated user',
    example: `curl -X GET localhost:3000/api/order  -H 'Authorization: Bearer tttttt'`,
    response: { dinerId: 4, orders: [{ id: 1, franchiseId: 1, storeId: 1, date: '2024-06-05T05:14:40.000Z', items: [{ id: 1, menuId: 1, description: 'Veggie', price: 0.05 }] }], page: 1 },
  },
  {
    method: 'POST',
    path: '/api/order',
    requiresAuth: true,
    description: 'Create a order for the authenticated user',
    example: `curl -X POST localhost:3000/api/order -H 'Content-Type: application/json' -d '{"franchiseId": 1, "storeId":1, "items":[{ "menuId": 1, "description": "Veggie", "price": 0.05 }]}'  -H 'Authorization: Bearer tttttt'`,
    response: { order: { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }], id: 1 }, jwt: '1111111111' },
  },
];

// getMenu
orderRouter.get(
  '/menu',
  asyncHandler(async (req, res) => {
    res.send(await DB.getMenu());
  })
);

// addMenuItem
orderRouter.put(
  '/menu',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to add menu item', 403);
    }

    const addMenuItemReq = req.body;
    await DB.addMenuItem(addMenuItemReq);
    res.send(await DB.getMenu());
  })
);

// getOrders
orderRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(await DB.getOrders(req.user, req.query.page));
  })
);

orderRouter.post('/', (req, res, next) => {
  if (enableChaos && Math.random() < 0.5) {
    metrics.chaosInjectedFailure();
    throw new StatusCodeError('Chaos monkey', 500);
  }
  next();
});

// createOrder
orderRouter.post(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const orderReq = req.body;
    const {franchiseId, storeId, items} = orderReq;

    // Validate store and get franchise
    const store = await DB.query(
      (await DB.getConnection()),
      'SELECT franchiseId FROM store WHERE id = ?',
      [storeId]
    );
    if(!store || store.length === 0)
    {
      throw new StatusCodeError('Store not found', 400);
    }

    // Verify storeId belongs to declared franchiseId
    const dbFranchiseId = store[0].franchiseId;
    if(dbFranchiseId !== franchiseId)
    {
      throw new StatusCodeError('Store does not belong to the specified franchise', 400);
    }

    // Fetch menu prices from database
    const menuIds = items.map(item => item.menuId);
    const connection = await DB.getConnection();
    const menuItems = await DB.query(
      connection,
      `SELECT id, price FROM menu WHERE id IN (${menuIds.map(() => '?').join(',')})`,
      menuIds
    );
    connection.end();

    // Verify all menu items exist
    if(menuItems.length !== menuIds.length)
    {
      throw new StatusCodeError('One or more menu items not found', 400);
    }

    // Reconstruct order items with prices from database to prevent tampering
    const confirmedOrder = {
      franchiseId,
      storeId,
      items: items.map(clientItem => {
        const menuItem = menuItems.find(mi => mi.id === clientItem.menuId);
        return {
          menuId: clientItem.menuId,
          description: clientItem.description,
          price: menuItem.price, // Use price from database
        };
      })
    };

    const order = await DB.addDinerOrder(req.user, confirmedOrder);
    const orderInfo = { diner: { id: req.user.id, name: req.user.name, email: req.user.email }, order };
    logger.log('info', 'factory', orderInfo);

    // Calculate pizza metrics
    const numPizzas = order.items.length;
    const totalRevenue = order.items.reduce((sum, item) => sum + Number(item.price), 0);

    // Track factory latency
    const factoryStartTime = Date.now();
    const r = await fetch(`${config.factory.url}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${config.factory.apiKey}` },
      body: JSON.stringify({ diner: { id: req.user.id, name: req.user.name, email: req.user.email }, order }),
    });
    const factoryDuration = Date.now() - factoryStartTime;
    metrics.pizzaFactoryLatency(factoryDuration);

    const j = await r.json();
    if (r.ok) {
      metrics.pizzaPurchaseSuccess(numPizzas, totalRevenue);
      res.send({ order, followLinkToEndChaos: j.reportUrl, jwt: j.jwt });
    } else {
      metrics.pizzaPurchaseFailure(numPizzas);
      res.status(500).send({ message: 'Failed to fulfill order at factory', followLinkToEndChaos: j.reportUrl });
    }

    logger.log(r.ok ? 'info' : 'warn', 'factory', {
      event: 'factory_response',
      statusCode: r.status,
      responseBody: j,
    });
  })
);

let enableChaos = false;
orderRouter.put(
  '/chaos/:state',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.user.isRole(Role.Admin)) {
      enableChaos = req.params.state === 'true';
      metrics.chaosToggle(enableChaos);
    }

    res.json({ chaos: enableChaos });
  })
);

orderRouter.put(
  '/chaos/kill',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.user.isRole(Role.Admin)) {
      enableChaos = false;
      metrics.chaosToggle(enableChaos);
      metrics.chaosClearFailures();
      logger.log('error', 'chaosKill', { message: 'Chaos killed by admin', userId: req.user.id });
    }

    res.json({ chaos: enableChaos });
  })
);

module.exports = orderRouter;
