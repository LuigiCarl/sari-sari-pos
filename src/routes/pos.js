const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/posController');

const router = express.Router();
router.use(requireRole('sales_rep'));

router.get('/', ctrl.posScreen);
router.get('/api/products', ctrl.searchProducts);
router.post('/checkout', ctrl.postCheckout);
router.get('/receipt/:id', ctrl.viewReceipt);
router.get('/sales', ctrl.mySales);

router.get('/inventory', ctrl.inventoryScreen);
router.post('/inventory/report', ctrl.postInventoryReport);

module.exports = router;
