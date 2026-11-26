// Changes to the signed-in user's own profile. Each call saves on the server, then stores the user it
// returns; session.setUser() tells onAuthChange listeners, so the avatars and names in the shell update
// straight away. Errors are api.js ApiErrors (message for the user, status for the code).
import { api } from '../api.js';
import * as session from './session.js';

const save = async promise => { const user = await promise; session.setUser(user); return user; };

export const renameUser = username => save(api.updateMe(username.trim()));
export const uploadAvatar = blob => save(api.uploadAvatar(blob));
export const removeAvatar = () => save(api.removeAvatar());

// Sends a code to the new address. Rejects with status 409 when another account already uses it.
export const requestEmailChange = newEmail => api.requestEmailChange(newEmail.trim().toLowerCase());
export const confirmEmailChange = (newEmail, code) => save(api.confirmEmailChange(newEmail.trim().toLowerCase(), code));
