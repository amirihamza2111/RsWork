const express = require('express');
const {
  getFeedbacks,
  createFeedback,
  updateFeedbackReviewedStatus,
  getUnreadCount,
} = require('../controllers/feedbackController');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();

router
  .route('/')
  .get(protect, authorize('manager', 'superadmin'), getFeedbacks)
  .post(createFeedback);

router.route('/unread-count').get(protect, authorize('manager', 'superadmin'), getUnreadCount);

router
  .route('/:id/reviewed')
  .put(protect, authorize('manager', 'superadmin'), updateFeedbackReviewedStatus);

module.exports = router;
