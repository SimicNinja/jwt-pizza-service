const config = require('./config');
const os = require('os');

// Metrics stored in memory
const requests = {};
const requestsByMethod = {};
const activeUsers = new Map(); // Map<userId, lastSeenTimestamp>
const ACTIVE_USER_WINDOW = 5 * 60 * 1000; // 5 minutes in milliseconds
let authAttempts = { success: 0, failure: 0 };
let pizzaMetrics = { sold: 0, failures: 0, revenue: 0 };
let latencyMetrics = { service: 0, factory: 0 };
let chaosMetrics = { enabled: 0, injectedFailures: 0 };

// Middleware to track requests
function requestTracker(req, res, next) {
	const endpoint = `[${req.method}] ${req.path}`;
	requests[endpoint] = (requests[endpoint] || 0) + 1;
	requestsByMethod[req.method] = (requestsByMethod[req.method] || 0) + 1;

	// Track active users if authenticated
	if (req.user && req.user.id) {
		activeUsers.set(req.user.id, Date.now());
	}

	// Track service latency
	const startTime = Date.now();
	res.on('finish', () => {
		const duration = Date.now() - startTime;
		latencyMetrics.service += duration;
	});

	next();
}

// Track authentication attempts
function authAttemptSuccess() {
	authAttempts.success++;
}

function authAttemptFailure() {
	authAttempts.failure++;
}

// Track pizza purchases
function pizzaPurchaseSuccess(numPizzas, totalRevenue) {
	pizzaMetrics.sold += numPizzas;
	pizzaMetrics.revenue += totalRevenue;
}

function pizzaPurchaseFailure(numPizzas) {
	pizzaMetrics.failures += numPizzas;
}

// Track factory latency
function pizzaFactoryLatency(duration) {
	latencyMetrics.factory += duration;
}

function chaosToggle(enabled) {
	chaosMetrics.enabled = enabled ? 1 : 0;
}

function chaosInjectedFailure() {
	chaosMetrics.injectedFailures++;
}

function chaosClearFailures() {
	chaosMetrics.injectedFailures = 0;
}

// This will periodically send metrics to Grafana
setInterval(() => {
	const metrics = [];
	Object.keys(requests).forEach((endpoint) => {
	const endpointParts = endpoint.match(/^\[([^\]]+)\]\s+(.*)$/);
	const method = endpointParts?.[1] || 'UNKNOWN';
	const path = endpointParts?.[2] || endpoint;
	metrics.push(createMetric('requests', requests[endpoint], '1', 'sum', 'asInt', { endpoint, method, path }));
	});

	Object.keys(requestsByMethod).forEach((method) => {
	metrics.push(createMetric('requestsByMethod', requestsByMethod[method], '1', 'sum', 'asInt', { method }));
	});

	// Clean up old active users and count current ones
	const now = Date.now();
	for (const [userId, lastSeen] of activeUsers.entries()) {
		if (now - lastSeen > ACTIVE_USER_WINDOW) {
			activeUsers.delete(userId);
		}
	}
	const activeUserCount = activeUsers.size;
	metrics.push(createMetric('activeUsers', activeUserCount, '1', 'gauge', 'asInt', {}));

	// Send auth attempts with labels for success/failure
	metrics.push(createMetric('authAttempts', authAttempts.success, '1', 'sum', 'asInt', { result: 'success' }));
	metrics.push(createMetric('authAttempts', authAttempts.failure, '1', 'sum', 'asInt', { result: 'failure' }));

	// Send system metrics
	const cpuUsage = getCpuUsagePercentage();
	const memoryUsage = getMemoryUsagePercentage();
	metrics.push(createMetric('cpu', cpuUsage, '%', 'gauge', 'asDouble', {}));
	metrics.push(createMetric('memory', memoryUsage, '%', 'gauge', 'asDouble', {}));

	// Send pizza metrics
	metrics.push(createMetric('pizzasSold', pizzaMetrics.sold, '1', 'sum', 'asInt', {}));
	metrics.push(createMetric('pizzaFailures', pizzaMetrics.failures, '1', 'sum', 'asInt', {}));
	metrics.push(createMetric('pizzaRevenue', pizzaMetrics.revenue, 'USD', 'sum', 'asDouble', {}));

	// Send latency metrics (cumulative milliseconds)
	metrics.push(createMetric('serviceLatency', latencyMetrics.service, 'ms', 'sum', 'asInt', {}));
	metrics.push(createMetric('factoryLatency', latencyMetrics.factory, 'ms', 'sum', 'asInt', {}));

	// Send chaos metrics
	metrics.push(createMetric('chaosEnabled', chaosMetrics.enabled, '1', 'gauge', 'asInt', {}));
	metrics.push(createMetric('chaosToggles', chaosMetrics.toggles, '1', 'sum', 'asInt', {}));
	metrics.push(createMetric('chaosInjectedFailures', chaosMetrics.injectedFailures, '1', 'sum', 'asInt', {}));

	sendMetricToGrafana(metrics);
}, 10000);

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
	attributes = { ...attributes, source: config.metrics.source };

	const metric = {
		name: metricName,
		unit: metricUnit,
		[metricType]: {
		dataPoints: [
			{
			[valueType]: metricValue,
			timeUnixNano: Date.now() * 1000000,
			attributes: [],
			},
		],
		},
	};

	Object.keys(attributes).forEach((key) => {
		metric[metricType].dataPoints[0].attributes.push({
		key: key,
		value: { stringValue: attributes[key] },
		});
	});

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

	return metric;
}

function sendMetricToGrafana(metrics) {
	const body = {
		resourceMetrics: [
		{
			scopeMetrics: [
			{
				metrics,
			},
			],
		},
		],
	};

	const bodyString = JSON.stringify(body);
	fetch(`${config.metrics.endpointUrl}`, {
		method: 'POST',
		body: bodyString,
		headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
	})
	.then((response) => {
		if (!response.ok) {
			response.text().then((text) => {
				console.error(`Failed to push metrics data to Grafana: ${text}\n${bodyString}`);
			});
		} else {
			console.log(`Successfully pushed ${metrics.length} metrics to Grafana`);
		}
	})
	.catch((error) => {
		console.error('Error pushing metrics:', error);
	});
}

function getCpuUsagePercentage() {
	const cpuUsage = os.loadavg()[0] / os.cpus().length;
	return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
	const totalMemory = os.totalmem();
	const freeMemory = os.freemem();
	const usedMemory = totalMemory - freeMemory;
	const memoryUsage = (usedMemory / totalMemory) * 100;
	return memoryUsage.toFixed(2);
}

module.exports = { requestTracker, authAttemptSuccess, authAttemptFailure, pizzaPurchaseSuccess, pizzaPurchaseFailure, pizzaFactoryLatency, chaosToggle, chaosInjectedFailure };