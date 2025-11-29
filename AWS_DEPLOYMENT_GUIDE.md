# AWS Deployment Guide - Resume Builder API

This guide provides multiple options for deploying your Resume Builder API on AWS, migrating from Render.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Elastic Beanstalk CLI (eb CLI) installed
- Docker installed for containerized deployments

## Deployment Options

### Option 1: AWS Elastic Beanstalk (Recommended for Migration)

Elastic Beanstalk is the simplest option for migrating from Render and provides automatic scaling and load balancing.

#### Step 1: Initialize Elastic Beanstalk

```bash
# Install EB CLI if not already installed
pip install awsebcli

# Initialize your Elastic Beanstalk application
eb init resume-builder-api --region us-east-1 --platform docker

# Create production environment
eb create ResumeApi-Production --region us-east-1
```

#### Step 2: Configure Environment Variables

In the AWS Console:
1. Go to Elastic Beanstalk → Your Application → ResumeApi-Production
2. Navigate to "Configuration" → "Software" → "Edit"
3. Add environment variables in "Environment properties":

```
NODE_ENV=production
DATABASE_URL=your_production_database_url
OPENAI_API_KEY=your_openai_api_key
OPENAI_ASSISTANT_ID=your_openai_assistant_id
AUTH0_DOMAIN=your_auth0_domain
AUTH0_AUDIENCE=your_eb_app_url.elasticbeanstalk.com
AUTH0_CLIENT_SECRET=your_auth0_client_secret
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PRICE_ID_PREMIUM=your_stripe_price_id
FRONTEND_URL=your_frontend_url
ALLOWED_ORIGINS=your_frontend_urls_comma_separated
```

#### Step 3: Update Auth0 Configuration

In Auth0 Dashboard:
1. Go to Applications → Your Application
2. Add your Elastic Beanstalk URL to "Allowed Callback URLs"
3. Add your Elastic Beanstalk URL to "Allowed Web Origins"

#### Step 4: Update Stripe Webhook

In Stripe Dashboard:
1. Update webhook endpoint URL to your Elastic Beanstalk URL + `/api/stripe/webhook`

#### Step 5: Deploy

```bash
# Deploy your application
eb deploy

# Check deployment status
eb status
```

### Option 2: AWS ECS with Fargate

For more control and better container orchestration.

#### Step 1: Build and Push Docker Image

```bash
# Build Docker image
docker build -t resume-builder-api .

# Tag for ECR
docker tag resume-builder-api:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/resume-builder-api:latest

# Push to ECR (after creating repository)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/resume-builder-api:latest
```

#### Step 2: Create ECS Task Definition

Create a task definition file (`task-definition.json`):

```json
{
  "family": "resume-builder-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "resume-builder-api",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/resume-builder-api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "3000"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:ssm:us-east-1:123456789012:parameter/resume-api/database-url"
        }
        // Add other secrets as needed
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/resume-builder-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### Step 3: Create ECS Service

Use AWS Console or AWS CLI to create:
1. ECS Cluster
2. ECS Service with Application Load Balancer
3. Security Groups and VPC configuration

### Option 3: AWS Lambda with API Gateway

For serverless deployment (requires code refactoring for Lambda).

## Database Considerations

### PostgreSQL on AWS RDS

1. **Create RDS Instance:**
   ```bash
   aws rds create-db-instance \
     --db-instance-identifier resume-api-db \
     --db-instance-class db.t3.micro \
     --engine postgres \
     --engine-version 14.9 \
     --master-username admin \
     --master-user-password your-secure-password \
     --allocated-storage 20 \
     --vpc-security-group-ids sg-12345678 \
     --db-subnet-group-name default
   ```

2. **Run Migrations:**
   ```bash
   # Update DATABASE_URL to point to RDS instance
   export DATABASE_URL="postgresql://admin:password@your-db-endpoint:5432/resume_api"
   npm run db:migrate
   ```

### Alternative: Use Prisma Accelerate (Current Setup)

Your current setup uses Prisma Accelerate, which works well with AWS deployments. The DATABASE_URL in your .env file points to Prisma Cloud.

## Monitoring and Logging

### CloudWatch Integration

1. Enable CloudWatch logs in your deployment
2. Set up alarms for:
   - API response times
   - Error rates
   - Database connections
   - CPU/Memory utilization

### Health Checks

The application includes a `/health` endpoint that AWS Load Balancer can use for health checks.

## Security Considerations

### SSL/TLS

AWS provides automatic SSL certificates through AWS Certificate Manager when using:
- Application Load Balancer
- CloudFront distribution

### Secrets Management

Use AWS Systems Manager Parameter Store or AWS Secrets Manager for sensitive data:

```bash
# Store sensitive data in Parameter Store
aws ssm put-parameter \
  --name "/resume-api/stripe-webhook-secret" \
  --value "your-webhook-secret" \
  --type SecureString
```

## Cost Optimization

### Elastic Beanstalk
- Single instance: ~$5-15/month
- Load balanced: ~$15-50/month

### ECS Fargate
- Similar to Elastic Beanstalk but more control
- Costs scale with usage

### Recommended for Your Use Case
- **Elastic Beanstalk** is recommended for your migration from Render
- Provides similar experience to Render but with AWS infrastructure
- Handles deployment, scaling, and monitoring automatically

## Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**
   - Check Elastic Beanstalk console for configuration
   - Verify variable names match exactly

2. **Database Connection Issues**
   - Ensure RDS security groups allow connections from EC2 instances
   - Check DATABASE_URL format

3. **Auth0 Integration Issues**
   - Verify AUTH0_AUDIENCE matches your application URL
   - Check Auth0 application configuration

4. **Stripe Webhook Issues**
   - Update webhook URL in Stripe dashboard
   - Verify webhook secret matches environment variable

### Logs and Debugging

```bash
# Elastic Beanstalk logs
eb logs

# ECS logs (via CloudWatch)
aws logs get-log-events --log-group-name /ecs/resume-builder-api
```

## Post-Deployment Steps

1. Update your frontend to point to the new AWS API endpoint
2. Update any DNS records if using custom domain
3. Update webhook URLs in third-party services (Stripe, Auth0)
4. Set up monitoring and alerting
5. Create backup strategy for database and application data
6. Set up CI/CD pipeline for future deployments

## Rollback Strategy

### Elastic Beanstalk
```bash
# Rollback to previous version
eb deploy --version previous-version-id
```

### ECS
- Maintain previous task definition
- Switch service to use previous task definition

Your application is now ready for AWS deployment! Start with Elastic Beanstalk for the simplest migration experience.