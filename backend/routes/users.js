const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
} = require('../controllers/userController');
router.use(protect);
router.get('/', authorize('manager', 'superadmin'), getAllUsers);
router.get('/:id', authorize('manager', 'superadmin'), getUserById);
router.put('/:id', authorize('manager', 'superadmin'), updateUser);
router.delete('/:id', authorize('manager', 'superadmin'), deleteUser);
module.exports = router;