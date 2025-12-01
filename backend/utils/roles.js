export const deriveRole = (email = '') =>
  email.toLowerCase().endsWith('@fgcu.edu') ? 'instructor' : 'student';

export const isInstructorEmail = (email = '') => deriveRole(email) === 'instructor';
