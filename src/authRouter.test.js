const request = require('supertest');
const app = require('./service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
	testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
	const registerRes = await request(app).post('/api/auth').send(testUser);
	testUserAuthToken = registerRes.body.token;
});

test('register', async () => {
	const testUser2 = { name: "register dan", email: "dan@test.com", password: "b" };
	const registerRes = await request(app).post('/api/auth').send(testUser2);

	expect(registerRes.status).toBe(200);
	expect(registerRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

	const user = { ...testUser2, roles: [{ role: 'diner' }] };
	delete user.password;
	expect(registerRes.body.user).toMatchObject(user);
});

test('register without password', async () => {
	const testUser3 = { name: "register stan", email: "stan@test.com"};
	const registerRes = await request(app).post('/api/auth').send(testUser3);

	expect(registerRes.status).toBe(400);
	expect(registerRes.body).toMatchObject({ message: 'name, email, and password are required' });
});

test('login', async () => {
	const loginRes = await request(app).put('/api/auth').send(testUser);
	expect(loginRes.status).toBe(200);
	expect(loginRes.body.token).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);

	const user = { ...testUser, roles: [{ role: 'diner' }] };
	delete user.password;
	expect(loginRes.body.user).toMatchObject(user);
});

test('logout', async () => {
	const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${testUserAuthToken}`);
	
	expect(logoutRes.status).toBe(200);
	expect(logoutRes.body).toMatchObject({ message: 'logout successful' });
});

test("logout with invalid token", async () => {
	const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer invalidtoken123`);

	expect(logoutRes.status).toBe(401);
	expect(logoutRes.body).toMatchObject({ message: 'unauthorized' });
});