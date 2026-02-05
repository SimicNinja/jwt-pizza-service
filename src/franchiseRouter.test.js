const request = require('supertest');
const app = require('./service');
const { DB } = require('./database/database.js');

let franchiseeUser = { name: 'franchisee user', email: Math.random().toString(36).substring(2, 12) + '@test.com', password: 'franchisee' };
let testUser = { name: 'test diner', email: Math.random().toString(36).substring(2, 12) + '@test.com', password: 'test' };
let adminAuthToken;
let franchiseeAuthToken;
let testUserAuthToken;
let testFranchise;
let testStore;

beforeAll(async () => {
	await DB.initialized;

	// Login admin user
	const adminLogin = await request(app).put('/api/auth').send({ email: 'a@jwt.com', password: 'admin' });
	console.log('Admin login status:', adminLogin.status);
    console.log('Admin login body:', adminLogin.body);
    if (!adminLogin.body.token) {
        throw new Error('Failed to login as admin');
    }
	adminAuthToken = adminLogin.body.token;

	// Register franchisee user
	const franchiseeRes = await request(app).post('/api/auth').send(franchiseeUser);
	franchiseeAuthToken = franchiseeRes.body.token;
	franchiseeUser.id = franchiseeRes.body.user.id;

	// Register test user
    const testUserRes = await request(app).post('/api/auth').send(testUser);
    testUserAuthToken = testUserRes.body.token;
    testUser.id = testUserRes.body.user.id;

	// Create test franchises for franchisee user
	const franchiseData = { name: "test franchisee pizza" + Math.random().toString(36).substring(2, 12), admins: [{ email: franchiseeUser.email }] };
	const franchiseRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchiseData);
	testFranchise = franchiseRes.body;

	const franchiseData2 = { name: "test2 franchisee pizza" + Math.random().toString(36).substring(2, 12), admins: [{ email: franchiseeUser.email }] };
	await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchiseData2);

	// Create test store
	const storeData = { name: "SLC" };
	const storeRes = await request(app).post(`/api/franchise/${testFranchise.id}/store`).set('Authorization', `Bearer ${franchiseeAuthToken}`).send(storeData);
	testStore = storeRes.body;
});

test('Create franchise', async () => {
	const franchiseData = { name: "franchisee pizza" + Math.random().toString(36).substring(2, 12), admins: [{ email: franchiseeUser.email }] };

	const createRes = await request(app)
		.post('/api/franchise')
		.set('Authorization', `Bearer ${adminAuthToken}`)
		.send(franchiseData);

	expect(createRes.status).toBe(200);
	expect(createRes.body).toMatchObject({
		name: franchiseData.name,
		admins: [{
			email: franchiseeUser.email,
			id: franchiseeUser.id,
			name: "franchisee user"
		}],
		id: expect.any(Number)
	});
});

test('Create franchise without admin rights', async () => {
	const franchiseData = { name: "franchisee pizza" + Math.random().toString(36).substring(2, 12), admins: [{ email: franchiseeUser.email }] };

	const createRes = await request(app)
		.post('/api/franchise')
		.set('Authorization', `Bearer ${franchiseeAuthToken}`)
		.send(franchiseData);

	expect(createRes.status).toBe(403);
	expect(createRes.body).toMatchObject({ message: 'unable to create a franchise' });
});

test('Get franchises', async () => {
	const getRes = await request(app).get('/api/franchise');

	console.log(getRes.body);

	expect(getRes.status).toBe(200);
	expect(getRes.body.franchises.length).toBeGreaterThanOrEqual(2);
	expect(getRes.body).toHaveProperty('franchises');
	expect(Array.isArray(getRes.body.franchises)).toBe(true);
	expect(getRes.body).toHaveProperty('more');
});

test('Get user franchises', async () => {
	const getRes = await request(app).get(`/api/franchise/${franchiseeUser.id}`).set('Authorization', `Bearer ${franchiseeAuthToken}`);

	expect(getRes.status).toBe(200);
	expect(getRes.body.length).toBeGreaterThanOrEqual(2);

	expect(Array.isArray(getRes.body)).toBe(true);

	getRes.body.forEach(franchise => {
		expect(franchise).toHaveProperty('id');
		expect(franchise).toHaveProperty('name');
		expect(franchise).toHaveProperty('admins');
		expect(franchise).toHaveProperty('stores');

		expect(franchise.admins).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: franchiseeUser.id,
					email: franchiseeUser.email,
					name: franchiseeUser.name
				})
			])
		);
	});
});

test('Create store', async () => {
	const storeData = { name: "Provo" };

	const createRes = await request(app)
		.post(`/api/franchise/${testFranchise.id}/store`)
		.set('Authorization', `Bearer ${franchiseeAuthToken}`)
		.send(storeData);

	expect(createRes.status).toBe(200);
	expect(createRes.body).toMatchObject({
		id: expect.any(Number),
		franchiseId: testFranchise.id,
		name: "Provo"
	});
});

test('Create store without franchisee rights', async () => {
    const storeData = { name: "Orem" };

    const createRes = await request(app)
        .post(`/api/franchise/${testFranchise.id}/store`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(storeData);

    expect(createRes.status).toBe(403);
    expect(createRes.body).toMatchObject({ message: 'unable to create a store' });
});

test('Delete store', async () => {
    const deleteRes = await request(app)
        .delete(`/api/franchise/${testFranchise.id}/store/${testStore.id}`)
        .set('Authorization', `Bearer ${franchiseeAuthToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toMatchObject({ message: 'store deleted' });
});

test('Delete store without franchisee rights', async () => {
    // const storeData = { name: "Delete Test" };
    // const createRes = await request(app)
    //     .post(`/api/franchise/${testFranchise.id}/store`)
    //     .set('Authorization', `Bearer ${franchiseeAuthToken}`)
    //     .send(storeData);
    // const storeToDelete = createRes.body;

    const deleteRes = await request(app)
        .delete(`/api/franchise/${testFranchise.id}/store/${testStore.id}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body).toMatchObject({ message: 'unable to delete a store' });
});

test('Delete franchise', async () => {
    const deleteRes = await request(app)
        .delete(`/api/franchise/${testFranchise.id}`)
        .set('Authorization', `Bearer ${adminAuthToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toMatchObject({ message: 'franchise deleted' });
});