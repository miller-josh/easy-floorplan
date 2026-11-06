# Simple login: name + password

The app signs in through Clerk, so "name + simple password" is a Clerk dashboard setting, not a code change. Clerk also keeps you signed in across reloads, so you only enter it once per device.

In the Clerk Dashboard for your app:

1. **Configure > User & authentication > Email, phone, username**
   - Turn **Username** on and mark it **Required**.
   - Turn **Email address** off (or make it optional, with **Verify at sign-up** off).
2. **Password**
   - Keep **Sign-up with password** on.
   - Under password settings, turn off the strength and breach checks that reject short or common passwords (for example "Reject compromised passwords" and the minimum length). Something like `disco$ucks` then works.
3. **Social connections**: turn all off.
4. Optional: **Sessions** > raise the session lifetime so it rarely asks again.

The sign-in screen (`src/Auth.jsx`) now shows a short prompt and hides social buttons. Sign-up is still available from the link under the form, so new people can pick their own name and password.

Note: this is not session storage. A Clerk session lasts until it expires or you sign out, which is what you want for "enter once and it sticks".
