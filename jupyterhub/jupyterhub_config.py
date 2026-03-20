c = get_config()  # noqa

# --- Bind settings ---
c.JupyterHub.bind_url = 'https://0.0.0.0:443'

# --- SSL ---
c.JupyterHub.ssl_cert = '/etc/letsencrypt/live/zhang-capra-xcel.ece.cornell.edu/fullchain.pem'
c.JupyterHub.ssl_key = '/etc/letsencrypt/live/zhang-capra-xcel.ece.cornell.edu/privkey.pem'

# --- Authentication ---
# PAM authenticator checks passwords against Linux system users
c.JupyterHub.authenticator_class = 'jupyterhub.auth.PAMAuthenticator'
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


def copy_shared_files(spawner):
    user_home = os.path.expanduser(f"/home/{spawner.user.name}")
    shared_dir = "/srv/jupyterhub/shared"

    # Copy everything from shared directory to user home
    # Use copy (not copy2) to avoid preserving source permissions
    if os.path.isdir(shared_dir):
        for item in os.listdir(shared_dir):
            src = os.path.join(shared_dir, item)
            dst = os.path.join(user_home, item)
            if os.path.isdir(src):
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                shutil.copytree(src, dst,
                                copy_function=shutil.copy)
                print(f"Copied directory {item} to {user_home}")
            else:
                shutil.copy(src, dst)
                print(f"Copied {item} to {user_home}")
        # Make everything writable (users need to create build dirs, checkpoints, etc.)
        import subprocess
        subprocess.run(["chmod", "-R", "777", user_home], capture_output=True)


c.Spawner.pre_spawn_hook = copy_shared_files
