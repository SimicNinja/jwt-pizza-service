const request = require('supertest');
const app = require('./service');
const {DB, Role} = require('./database/database.js');

let adminUser = { name: 'admin user', email: Math.random().toString(36).substring(2, 12) + '@admin.com', password: 'admin', roles: [{role: Role.Admin}]};
let testUser = { name: 'test diner', email: Math.random().toString(36).substring(2, 12) + '@test.com', password: 'test' };
let adminAuthToken;
let testUserAuthToken;
let testMenuItemId;

beforeAll(async () => {
	await DB.initialized;

	// Wait for database to initialize
	await DB.initialized;
	
	// Register and login admin user
	await DB.addUser(adminUser);
	const adminLogin = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });	

	if(!adminLogin.body.token){
		throw new Error('Admin login failed');
	}
	adminAuthToken = adminLogin.body.token;

	// Register test user
    const testUserRes = await request(app).post('/api/auth').send(testUser);
    testUserAuthToken = testUserRes.body.token;
    testUser.id = testUserRes.body.user.id;

	// Add menu item for testing
	const newMenuItem = { title: 'Veggie', description: 'Veggie Piaaz', price: 0.05, image: 'veggie.png' };
	const menuItemRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminAuthToken}`).send(newMenuItem);
	testMenuItemId = menuItemRes.body[menuItemRes.body.length - 1].id;
});

test('Add item to menu as admin', async () => {
	const newMenuItem = { title: 'Test Item', description: 'Test Description', price: 1.99, image: 'test.png' };
	const res = await request(app)
		.put('/api/order/menu')
		.set('Authorization', `Bearer ${adminAuthToken}`)
		.send(newMenuItem);

	expect(res.statusCode).toBe(200);
	expect(res.body).toEqual(expect.arrayContaining([
		expect.objectContaining({ title: 'Test Item', description: 'Test Description', price: 1.99, image: 'test.png' }),
	]));
});

test('Add item to menu as non-admin', async () => {
	const newMenuItem = { title: 'Test Item 2', description: 'Test Description 2', price: 2.99, image: 'test2.png' };
	const res = await request(app)
		.put('/api/order/menu')
		.set('Authorization', `Bearer ${testUserAuthToken}`)
		.send(newMenuItem);

	expect(res.statusCode).toBe(403);
	expect(res.body).toMatchObject({ message: 'unable to add menu item' });
});

test('Create order', async () => {
	const orderData = { franchiseId: 1, storeId: 1, items: [{ menuId: testMenuItemId, description: 'Veggie', price: 0.05 }] };
	const res = await request(app)
		.post('/api/order')
		.set('Authorization', `Bearer ${testUserAuthToken}`)
		.send(orderData);

	console.log(res.statusCode);
	console.log(res.body);

	expect(res.statusCode).toBe(200);
	expect(res.body).toMatchObject({
		order: { franchiseId: 1, storeId: 1, items: [{ menuId: testMenuItemId, description: 'Veggie', price: 0.05 }] },
		jwt: expect.any(String),
	});
});