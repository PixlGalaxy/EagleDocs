export const deriveRoleFromEmail = (email = '') => {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith('@fgcu.edu') ? 'instructor' : 'student';
};
