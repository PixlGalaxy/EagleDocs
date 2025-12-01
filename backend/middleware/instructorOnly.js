import { isInstructorEmail } from '../utils/roles.js';

export const requireInstructor = (req, res, next) => {
  if (!req.user || !isInstructorEmail(req.user.email)) {
    return res.status(403).json({ error: 'Instructor access required' });
  }
  return next();
};
