# Trading Bot Deployment Guide

This guide provides comprehensive instructions for deploying the trading bot application to a self-hosted VPS using the GitHub Actions CI/CD pipeline.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [VPS Setup](#vps-setup)
- [GitHub Secrets Configuration](#github-secrets-configuration)
- [First Deployment](#first-deployment)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Maintenance](#maintenance)
- [Security Best Practices](#security-best-practices)

---

## Overview

The CI/CD pipeline automatically deploys the complete trading bot stack:
- **IB Gateway** - Interactive Brokers trading gateway with automated 2FA
- **PostgreSQL** - Persistent database for bot configuration and trade history
- **Redis** - Cache and pub/sub for real-time data
- **FastAPI Backend** - REST API and trading bot logic

### Architecture

```
GitHub Actions (CI/CD)
    ↓
SSH to VPS
    ↓
Docker Compose Deployment
    ├── IB Gateway (172.25.0.5) - ports 4001, 4002, 5900, 8080
    ├── PostgreSQL (172.25.0.10) - port 5433
    ├── Redis (172.25.0.11) - port 6379
    └── FastAPI (172.25.0.20) - port 8000
```

---

## Prerequisites

### Required Accounts
1. **GitHub Account** - Repository with GitHub Actions enabled
2. **IBKR Account** - Interactive Brokers account (paper or live)
3. **VPS Provider** - Self-hosted server or VPS

### VPS Requirements
- **OS**: Ubuntu 20.04+ or Debian 11+
- **CPU**: 2+ cores
- **RAM**: 4GB minimum (8GB recommended)
- **Storage**: 40GB+ SSD
- **Network**: Public IP address with SSH access

### Local Machine Requirements
- SSH client (OpenSSH)
- Git
- Text editor

---

## VPS Setup

### 1. Connect to VPS

```bash
ssh your-user@your-vps-ip
```

### 2. Install Docker

```bash
# Update package index
sudo apt-get update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (optional, logout required)
sudo usermod -aG docker $USER

# Install Docker Compose V2
sudo apt-get install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

### 3. Install Additional Tools

```bash
sudo apt-get install -y git rsync curl
```

### 4. Create Deployment Directories

```bash
# Create directories
sudo mkdir -p /opt/trading-bot
sudo mkdir -p /opt/trading-bot-backups

# Set ownership to your user
sudo chown $USER:$USER /opt/trading-bot
sudo chown $USER:$USER /opt/trading-bot-backups
```

### 5. Configure Firewall

```bash
# Enable firewall if not already enabled
sudo ufw enable

# Allow SSH (if not already allowed)
sudo ufw allow 22/tcp

# Allow FastAPI Backend (external access)
sudo ufw allow 8000/tcp

# Optional: Allow VNC from specific IP only (for debugging)
sudo ufw allow from YOUR_IP_ADDRESS to any port 5900

# Check firewall status
sudo ufw status
```

### 6. Prepare SSH Key for GitHub Actions

You have two options: convert an existing PuTTY key or generate a new key.

#### Option A: Convert Existing PuTTY Key (If you use PuTTY)

**On Windows:**

1. Open **PuTTYgen** (comes with PuTTY installation)
2. Click **Load** and select your `.ppk` file
3. Enter passphrase if prompted
4. **CRITICAL**: Go to **Conversions** → **Export OpenSSH key (force new file format)**
   - ⚠️ **NOT** "Export OpenSSH key" (old format) - this creates wrong format!
   - ⚠️ Must select "Export OpenSSH key **(force new file format)**"
5. When asked about passphrase, **leave it EMPTY** (just press OK)
   - GitHub Actions cannot handle passphrase-protected keys
6. Save as `github_deploy_key` (no file extension)
7. Open the saved file in **Notepad** (not Word)
8. **Verify** the first line is EXACTLY:
   ```
   -----BEGIN OPENSSH PRIVATE KEY-----
   ```
   - ❌ If it says `-----BEGIN RSA PRIVATE KEY-----` you used the wrong export option!
   - ❌ If it says `PuTTY-User-Key-File-3` you didn't export at all!
   - ✅ Must say `-----BEGIN OPENSSH PRIVATE KEY-----` (with "OPENSSH")

**On Linux/Mac with .ppk file:**

```bash
# Install putty-tools
sudo apt-get install putty-tools  # Ubuntu/Debian
# OR
brew install putty  # macOS

# Convert to OpenSSH format (force new format)
puttygen your-key.ppk -O private-openssh -o github_deploy_key

# Verify format
head -1 github_deploy_key
# Should output: -----BEGIN OPENSSH PRIVATE KEY-----
```

#### Option B: Generate New OpenSSH Key Pair

On your **local machine** (not VPS):

```bash
# Generate ED25519 SSH key pair
ssh-keygen -t ed25519 -C "github-actions-deploy" -f github_deploy_key

# When prompted for passphrase, leave it EMPTY (press Enter twice)

# This creates:
#   - github_deploy_key (private key)
#   - github_deploy_key.pub (public key)
```

### 7. Add Public Key to VPS

```bash
# Copy public key content
cat github_deploy_key.pub

# SSH to VPS and add to authorized_keys
ssh your-user@your-vps-ip
mkdir -p ~/.ssh
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
exit
```

### 8. Test SSH Connection

```bash
# Test SSH with the private key
ssh -i github_deploy_key your-user@your-vps-ip

# If successful, you should be logged in without password
```

---

## GitHub Secrets Configuration

### 1. Navigate to Repository Settings

1. Go to your GitHub repository
2. Click **Settings**
3. Click **Secrets and variables** → **Actions**
4. Click **New repository secret**

### 2. Generate Secure Credentials

```bash
# Generate JWT Secret (64-char hex)
openssl rand -hex 64

# Generate PostgreSQL Password
openssl rand -base64 32

# Generate VNC Password
openssl rand -base64 16
```

### 3. Add Required Secrets

Add each of the following secrets (click "New repository secret" for each):

#### VPS Access (3 secrets)

| Secret Name | Value | Example |
|-------------|-------|---------|
| `VPS_HOST` | Your VPS IP or hostname | `203.0.113.10` |
| `VPS_SSH_USER` | SSH username | `ubuntu` |
| `VPS_SSH_PRIVATE_KEY` | Private key content | Contents of `github_deploy_key` file |

**Note**: For `VPS_SSH_PRIVATE_KEY`, paste the **entire** contents of the private key file, including the header and footer lines:
```
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

#### IB Credentials (4 secrets)

| Secret Name | Value | Notes |
|-------------|-------|-------|
| `IB_USERNAME` | IBKR username | Your Interactive Brokers username |
| `IB_PASSWORD` | IBKR password | Your Interactive Brokers password |
| `IB_TWOFA_SECRET` | TOTP secret (base32) | Required for live trading only |
| `VNC_SERVER_PASSWORD` | Strong password | For VNC GUI access (debugging) |

**Getting IB_TWOFA_SECRET**:
1. Log into IBKR account management
2. Enable two-factor authentication
3. When setting up authenticator app, save the base32 secret key
4. This is the value for `IB_TWOFA_SECRET`

#### Database (3 secrets)

| Secret Name | Value | Example |
|-------------|-------|---------|
| `POSTGRES_USER` | Database username | `tradingapp_user` |
| `POSTGRES_PASSWORD` | Generated password | Output of `openssl rand -base64 32` |
| `POSTGRES_DB` | Database name | `tradingapp_db` |

#### Application Security (1 secret)

| Secret Name | Value | Notes |
|-------------|-------|-------|
| `JWT_SECRET_KEY` | Generated hex string | Output of `openssl rand -hex 64` |

### 4. Optional Secrets (Will Use Defaults)

These are optional. If not set, sensible defaults will be used:

| Secret Name | Default Value |
|-------------|---------------|
| `IB_CLIENT_ID` | `42` |
| `IB_RTH_DEFAULT` | `true` |
| `IB_CONNECT_TIMEOUT` | `6` |
| `IB_RECONNECT_BACKOFF_SECONDS` | `3` |
| `IB_MARKETDATA_DELAY` | `1.5` |
| `IB_GATEWAY_RELEASE_CHANNEL` | `stable` |
| `LOG_LEVEL` | `INFO` |
| `SQL_LOG_LEVEL` | `WARNING` |
| `LOG_FORMAT` | `text` |

---

## First Deployment

### 1. Trigger Deployment

1. Go to your GitHub repository
2. Click **Actions** tab
3. Click **Deploy Trading Bot to VPS** workflow
4. Click **Run workflow** dropdown
5. Select **paper** trading mode (recommended for first deployment)
6. Click **Run workflow** button

### 2. Monitor Deployment

1. Click on the running workflow to see live logs
2. Watch each step complete:
   - ✅ Checkout Repository
   - ✅ Setup SSH
   - ✅ Generate Environment Files
   - ✅ Transfer Files to VPS
   - ✅ Deploy Services
   - ✅ Health Check - IB Gateway
   - ✅ Health Check - PostgreSQL
   - ✅ Health Check - Redis
   - ✅ Health Check - FastAPI Backend
   - ✅ Verify Deployment

### 3. Deployment Time

Typical deployment timeline:
- **Transfer & Setup**: 2-3 minutes
- **IB Gateway Startup**: 3-5 minutes (includes authentication)
- **Database & Redis**: 30 seconds
- **FastAPI Backend**: 1 minute
- **Health Checks**: 1-2 minutes

**Total**: ~8-12 minutes for first deployment

---

## Verification

### 1. Check Deployment Success

In GitHub Actions, you should see:
```
✅ ============================================
✅ DEPLOYMENT COMPLETED SUCCESSFULLY!
✅ ============================================

📝 Details:
   - Trading Mode: paper
   - Commit: abc123...
   - Branch: main
   - Timestamp: 2024-12-10 15:30:45 UTC

🔗 Access Points:
   - FastAPI: http://YOUR_VPS_IP:8000
   - API Docs: http://YOUR_VPS_IP:8000/docs
```

### 2. Verify on VPS

SSH to your VPS and check:

```bash
# Check all containers are running
docker ps

# Expected output:
# CONTAINER ID   IMAGE                COMMAND                  STATUS
# abc123def456   ib-gateway-local     "unstoppable -c..."      Up 5 minutes (healthy)
# 789ghi012jkl   postgres:15.3-alpine "docker-entrypoint..."   Up 5 minutes (healthy)
# 345mno678pqr   redis:7.2-alpine     "redis-server"           Up 5 minutes (healthy)
# 901stu234vwx   fastapi-app          "uvicorn app.main:..."   Up 4 minutes

# Check service health
docker inspect ib-gateway postgres redis fastapi-app --format='{{.Name}}: {{.State.Health.Status}}'

# Check logs
cd /opt/trading-bot/docker-ib-gateway
docker-compose logs -f
```

### 3. Test API Access

```bash
# From your local machine or VPS
curl http://YOUR_VPS_IP:8000/docs

# Should return HTML page with FastAPI documentation
```

### 4. Test API Health Endpoint

```bash
curl http://YOUR_VPS_IP:8000/api/health

# Should return JSON with service status
```

### 5. Access Web Interface

Open in browser:
```
http://YOUR_VPS_IP:8000/docs
```

You should see the FastAPI interactive documentation (Swagger UI).

---

## Troubleshooting

### Deployment Failed

If deployment fails, GitHub Actions will automatically attempt rollback. Check the logs for the specific failure step.

#### Common Issues

**1. SSH Private Key Error in GitHub Actions**
```
Error: The ssh-private-key argument is empty. Maybe the secret has not been configured,
or you are using a wrong secret name in your workflow file.
```

**Root Cause:** The most common cause is using a PuTTY format key or using the wrong PuTTYgen export option.

**Solution:**

If you converted a PuTTY key, you likely used "Export OpenSSH key" (old format) instead of "Export OpenSSH key **(force new file format)**".

**Step-by-step fix:**

1. Open **PuTTYgen**
2. Load your `.ppk` file
3. Go to **Conversions** → **Export OpenSSH key (force new file format)**
   - ⚠️ Make sure it says "(force new file format)" - this is critical!
4. Do NOT add a passphrase (press OK/Enter without typing anything)
5. Save as `github_deploy_key`
6. Open in Notepad and verify first line is:
   ```
   -----BEGIN OPENSSH PRIVATE KEY-----
   ```
   - ❌ If it says `-----BEGIN RSA PRIVATE KEY-----` → Wrong export option!
   - ✅ Must say `-----BEGIN OPENSSH PRIVATE KEY-----` (with "OPENSSH")
7. Copy ENTIRE file contents (including header/footer lines)
8. Go to GitHub → Settings → Secrets and variables → Actions
9. Update `VPS_SSH_PRIVATE_KEY` secret with new key
10. Retry the workflow

**Verification checklist:**
- ✅ Secret name is exactly `VPS_SSH_PRIVATE_KEY` (case-sensitive)
- ✅ Key starts with `-----BEGIN OPENSSH PRIVATE KEY-----`
- ✅ Key ends with `-----END OPENSSH PRIVATE KEY-----`
- ✅ No extra spaces or blank lines before/after the key
- ✅ No quotes or backticks wrapping the key
- ✅ Copied from plain text editor (Notepad), not Word

**2. SSH Connection Failed**
```
Error: ssh: connect to host X.X.X.X port 22: Connection refused
```

**Solution:**
- Verify VPS is running and accessible
- Check `VPS_HOST` secret is correct IP/hostname
- Verify SSH port 22 is open on VPS firewall
- Check `VPS_SSH_PRIVATE_KEY` has correct OpenSSH format (see issue #1)

**3. IB Gateway Authentication Failed**
```
❌ IB Gateway health check failed
```

**Solution:**
- Check `IB_USERNAME` and `IB_PASSWORD` are correct
- For live trading, verify `IB_TWOFA_SECRET` is correct
- Check IB Gateway logs: `docker logs ib-gateway --tail 100`
- Verify IBKR account is active and not locked

**4. Database Connection Failed**
```
❌ PostgreSQL health check failed
```

**Solution:**
- Check PostgreSQL logs: `docker logs postgres --tail 50`
- Verify `POSTGRES_PASSWORD` is set correctly
- Check if port 5433 is already in use: `sudo lsof -i :5433`

**5. FastAPI Not Responding**
```
❌ FastAPI health check failed
```

**Solution:**
- Check FastAPI logs: `docker logs fastapi-app --tail 100`
- Verify `JWT_SECRET_KEY` is set in GitHub Secrets
- Check if IB Gateway is healthy (FastAPI depends on it)
- Verify environment variables are passed correctly

### Manual Rollback

If automatic rollback fails:

```bash
# SSH to VPS
ssh your-user@your-vps-ip

# List available backups
ls -lh /opt/trading-bot-backups/

# Use rollback script
cd /opt/trading-bot/deployment/scripts
./rollback.sh 20241210-153045  # Use specific backup timestamp
```

### View Logs

```bash
# SSH to VPS
ssh your-user@your-vps-ip
cd /opt/trading-bot/docker-ib-gateway

# View all logs
docker-compose logs -f

# View specific service logs
docker logs ib-gateway -f
docker logs postgres -f
docker logs redis -f
docker logs fastapi-app -f

# View last 100 lines
docker logs ib-gateway --tail 100
```

### Restart Services

```bash
# SSH to VPS
cd /opt/trading-bot/docker-ib-gateway

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart fastapi-app

# Stop and start (full restart)
docker-compose down --timeout 30
docker-compose up -d
```

---

## Maintenance

### Daily Operations

```bash
# Check container status
docker ps

# Check logs for errors
docker-compose logs --tail=50

# Check disk space
df -h

# Check API health
curl http://localhost:8000/api/health
```

### Weekly Maintenance

1. **Review Logs**
   ```bash
   docker-compose logs --since 7d | grep -i error
   ```

2. **Check Disk Space**
   ```bash
   df -h
   docker system df
   ```

3. **Clean Up Old Docker Images**
   ```bash
   docker system prune -af
   ```

4. **Verify Backups**
   ```bash
   ls -lh /opt/trading-bot-backups/
   ```

### Database Backup

```bash
# Create manual database backup
docker exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d).sql

# Restore from backup
cat backup_20241210.sql | docker exec -i postgres psql -U $POSTGRES_USER -d $POSTGRES_DB
```

### Updating the Application

Simply trigger a new deployment from GitHub Actions. The CI/CD pipeline will:
1. Backup current deployment
2. Deploy new version
3. Run health checks
4. Rollback automatically if anything fails

---

## Security Best Practices

### 1. Credentials Management

- ✅ **DO**: Store all credentials in GitHub Secrets
- ✅ **DO**: Use strong, randomly generated passwords
- ✅ **DO**: Rotate credentials quarterly
- ❌ **DON'T**: Commit `.env` files to version control
- ❌ **DON'T**: Share credentials in plain text

### 2. Network Security

- ✅ **DO**: Use firewall to restrict port access
- ✅ **DO**: Only expose necessary ports (8000 for API)
- ✅ **DO**: Use SSH key authentication (no passwords)
- ✅ **DO**: Consider setting up HTTPS with nginx reverse proxy

### 3. VPS Hardening

```bash
# Disable SSH password authentication
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd

# Enable automatic security updates
sudo apt-get install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Set up fail2ban (optional)
sudo apt-get install fail2ban
```

### 4. Monitoring

- Set up external monitoring (e.g., Uptime Robot, Pingdom)
- Monitor disk space and set up alerts
- Review logs regularly for suspicious activity
- Set up log aggregation (optional: ELK stack, Datadog)

### 5. Access Control

- Limit VPS SSH access to known IP addresses
- Use VPN for accessing VNC (port 5900)
- Implement rate limiting on FastAPI endpoints
- Use JWT authentication for all API requests

---

## Trading Mode

### Paper Trading

Safe for testing and development:
```yaml
Trading Mode: paper
IB Port: 4002
2FA Required: No (typically)
Account Type: Paper trading account
```

**To Deploy:**
1. GitHub Actions → Run workflow
2. Select **paper** mode
3. Monitor deployment

### Live Trading

For production trading with real money:
```yaml
Trading Mode: live
IB Port: 4001
2FA Required: Yes (IB_TWOFA_SECRET must be set)
Account Type: Real brokerage account
```

**Before Going Live:**
1. ✅ Test thoroughly in paper trading mode
2. ✅ Verify all health checks pass
3. ✅ Set `IB_TWOFA_SECRET` in GitHub Secrets
4. ✅ Start with small position sizes
5. ✅ Monitor closely for first 24-48 hours

**To Deploy:**
1. GitHub Actions → Run workflow
2. Select **live** mode
3. Monitor deployment and logs carefully

---

## Support

### Getting Help

1. **Check Logs**: Most issues can be diagnosed from Docker logs
2. **Review This Guide**: Common issues are documented in Troubleshooting section
3. **GitHub Issues**: Report bugs or ask questions on GitHub repository

### Useful Commands Reference

```bash
# Container Management
docker ps                                  # List running containers
docker ps -a                              # List all containers
docker logs <container-name>              # View container logs
docker logs <container-name> -f           # Follow logs (live)
docker logs <container-name> --tail 100   # Last 100 lines
docker exec -it <container-name> bash     # Access container shell

# Docker Compose
docker-compose up -d                      # Start services
docker-compose down                       # Stop services
docker-compose restart                    # Restart all services
docker-compose restart <service>          # Restart specific service
docker-compose logs -f                    # View logs
docker-compose ps                         # List services

# System Maintenance
docker system prune -af                   # Clean up everything
docker volume ls                          # List volumes
docker network ls                         # List networks
df -h                                     # Check disk space
sudo ufw status                           # Check firewall

# Deployment Scripts
./deployment/scripts/deploy.sh paper      # Manual deployment
./deployment/scripts/health-check.sh      # Run health checks
./deployment/scripts/rollback.sh          # Rollback to previous version
```

---

## Next Steps

After successful deployment:

1. **Monitor for 24-48 hours** - Watch logs and verify stability
2. **Setup HTTPS** - Configure nginx reverse proxy with Let's Encrypt
3. **Enable Monitoring** - Set up Uptime Robot or similar service
4. **Configure Backups** - Automate PostgreSQL database backups to S3/cloud storage
5. **Deploy Frontend** - Set up React frontend deployment (separate workflow)
6. **Enable Alerts** - Configure email/Slack notifications for service failures

---

**Generated by Claude Code**
This deployment guide provides production-ready instructions for deploying your trading bot with security best practices and comprehensive troubleshooting.
