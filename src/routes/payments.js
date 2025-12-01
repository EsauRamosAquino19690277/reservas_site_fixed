import express from 'express';
const router = express.Router();

// Placeholders para callbacks de Mercado Pago / PayPal si luego configuras credenciales
router.get('/mp/callback', (req,res)=> res.send('MP callback OK'));
router.get('/paypal/callback', (req,res)=> res.send('PayPal callback OK'));

export default router;
