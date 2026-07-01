const { body } = require('express-validator');

exports.registerValidator = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

exports.loginValidator = [
  body('email').trim().isEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
];

exports.registerRestaurantValidator = [
  body('restaurantName').trim().notEmpty().withMessage('Restaurant name is required'),
  body('name').trim().notEmpty().withMessage('Manager name is required'),
  body('email').trim().isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

// Restaurant is derived from the table server-side, so it is not required here.
exports.createOrderValidator = [
  body('table')
    .notEmpty()
    .withMessage('Table ID is required')
    .isMongoId()
    .withMessage('Invalid table ID'),
  body('items').isArray({ min: 1 }).withMessage('Items array is required and must not be empty'),
  body('items.*.menuItem').isMongoId().withMessage('Each item needs a valid menuItem ID'),
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
];

exports.createMenuItemValidator = [
  body('name.fr').trim().notEmpty().withMessage('French name is required'),
  body('price')
    .notEmpty()
    .withMessage('Price is required')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isMongoId()
    .withMessage('Invalid category ID'),
  body('prepStation')
    .optional()
    .isIn(['kitchen', 'bar'])
    .withMessage('prepStation must be kitchen or bar'),
];

exports.createStaffValidator = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role')
    .optional()
    .isIn(['waiter', 'cashier', 'cook', 'manager'])
    .withMessage('Invalid staff role'),
];
