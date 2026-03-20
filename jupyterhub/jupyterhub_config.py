c = get_config()  # noqa

# --- Bind settings ---
c.JupyterHub.bind_url = 'https://0.0.0.0:443'

# --- SSL ---
c.JupyterHub.ssl_cert = '/etc/letsencrypt/live/zhang-capra-xcel.ece.cornell.edu/fullchain.pem'
c.JupyterHub.ssl_key = '/etc/letsencrypt/live/zhang-capra-xcel.ece.cornell.edu/privkey.pem'

# --- Authentication ---
# Use DummyAuthenticator for quick setup (any password works).
# Switch to PAM or SimpleAuthenticator for real passwords.
c.JupyterHub.authenticator_class = 'jupyterhub.auth.DummyAuthenticator'
c.Authenticator.admin_users = {'jianming', 'devansh', 'niansong'}
c.Authenticator.allow_all = True
c.Authenticator.allow_existing_users = True

# --- Spawner ---
c.Spawner.args = ['--allow-root']
c.Spawner.http_timeout = 30
c.JupyterHub.init_spawners_timeout = 10

# --- Pre-spawn hook: copy tutorial notebook to user home ---
import os
import shutil


def copy_notebook(spawner):
    user_home = os.path.expanduser(f"/home/{spawner.user.name}")
    shared_dir = "/srv/jupyterhub/shared"

    # Copy all notebooks from shared directory
    if os.path.isdir(shared_dir):
        for filename in os.listdir(shared_dir):
            if filename.endswith('.ipynb'):
                src = os.path.join(shared_dir, filename)
                dst = os.path.join(user_home, filename)
                shutil.copy(src, dst)
                print(f"Copied {filename} to {user_home}")


c.Spawner.pre_spawn_hook = copy_notebook
