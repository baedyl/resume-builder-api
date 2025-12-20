# Prerequisites Installation Guide

Before deploying your Resume Builder API to AWS, you need to install and configure the following tools.

## Required Tools

### 1. AWS CLI

```bash
# Install AWS CLI (macOS with Homebrew)
brew install awscli

# Or install via official installer
# Download from: https://aws.amazon.com/cli/

# Verify installation
aws --version
```

### 2. Elastic Beanstalk CLI (EB CLI)

```bash
# Install using pip3 (requires Python 3.x)
pip3 install awsebcli

# Verify installation
eb --version
```

### 3. Docker (Optional but Recommended)

```bash
# Install Docker Desktop for Mac
brew install --cask docker

# Or download from: https://www.docker.com/products/docker-desktop

# Verify installation
docker --version
```

### 4. Node.js and npm

```bash
# Install Node.js (should already be installed)
node --version
npm --version
```

## AWS Configuration

### 1. Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure

# You will be prompted for:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region name (e.g., us-east-1)
# - Default output format (json)
```

### 2. Verify AWS Credentials

```bash
# Test AWS access
aws sts get-caller-identity

# List your available regions
aws ec2 describe-regions
```

## Environment Variables Setup

Before deploying, copy the environment variables template and fill in your production values:

```bash
# Copy the template
cp .env.production.example .env.production

# Edit with your values
vim .env.production
```

## Verification Steps

Run these commands to verify everything is set up correctly:

```bash
# Check all prerequisites
node --version && npm --version && eb --version && aws --version && docker --version

# Test AWS credentials
aws sts get-caller-identity

# Verify EB CLI can access AWS
eb list
```

## Troubleshooting

### Common Issues

1. **EB CLI not found**: Ensure pip3 install completed successfully
   ```bash
   # Find installation location
   which eb
   # Add to PATH if needed
   export PATH="/Users/youruser/Library/Python/3.x/bin:$PATH"
   ```

2. **AWS credentials issues**: 
   ```bash
   # Check current credentials
   aws configure list
   
   # Reset credentials if needed
   aws configure delete
   aws configure
   ```

3. **Permission denied errors**:
   ```bash
   # Ensure AWS user has Elastic Beanstalk permissions
   # Check IAM policy for elasticbeanstalk:*
   ```

4. **Python version conflicts**:
   ```bash
   # Check Python version (EB CLI works with Python 3.x)
   python3 --version
   
   # If using pyenv or multiple Python versions
   pip3 install awsebcli --user
   ```

### Installation Verification

After installation, run this quick test:

```bash
# Test EB CLI initialization (will fail without AWS setup, but should run)
eb init resume-builder-api --region us-east-1 --platform docker
```

If you see an AWS authentication error rather than "command not found", the EB CLI is installed correctly and you just need to configure your AWS credentials.

## Next Steps

Once prerequisites are installed and configured:

1. [AWS Deployment Guide](./AWS_DEPLOYMENT_GUIDE.md) - Comprehensive deployment instructions
2. [AWS Deployment Summary](./AWS_DEPLOYMENT_SUMMARY.md) - Quick start guide