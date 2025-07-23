# Job Tracking API Documentation

This document describes the job tracking functionality that allows users to save and track their job applications.

## Database Schema

The `Job` model includes the following fields:

### Required Fields
- `position` (String): Job position/title
- `company` (String): Company name
- `location` (String): Job location

### Optional Fields
- `maxSalary` (Float): Maximum salary for the position
- `status` (String): Application status (e.g., "Applied", "Interview", "Rejected", "Accepted")
- `deadline` (DateTime): Application deadline
- `dateApplied` (DateTime): Date when the application was submitted
- `followUp` (DateTime): Follow-up date reminder
- `comment` (String): Additional notes or comments

## API Endpoints

All endpoints require authentication via the `Authorization` header with a valid JWT token.

### 1. Create Job Application
**POST** `/api/jobs`

Creates a new job application entry.

**Request Body:**
```json
{
  "position": "Software Engineer",
  "company": "Tech Corp",
  "location": "San Francisco, CA",
  "maxSalary": 120000,
  "status": "Applied",
  "deadline": "2024-02-15T23:59:59Z",
  "dateApplied": "2024-01-15T10:30:00Z",
  "followUp": "2024-01-22T10:00:00Z",
  "comment": "Applied through LinkedIn"
}
```

**Response (201):**
```json
{
  "id": 1,
  "userId": "user123",
  "position": "Software Engineer",
  "company": "Tech Corp",
  "location": "San Francisco, CA",
  "maxSalary": 120000,
  "status": "Applied",
  "deadline": "2024-02-15T23:59:59.000Z",
  "dateApplied": "2024-01-15T10:30:00.000Z",
  "followUp": "2024-01-22T10:00:00.000Z",
  "comment": "Applied through LinkedIn",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### 2. List All Job Applications
**GET** `/api/jobs`

Retrieves all job applications for the authenticated user, ordered by most recently updated.

**Response (200):**
```json
[
  {
    "id": 1,
    "userId": "user123",
    "position": "Software Engineer",
    "company": "Tech Corp",
    "location": "San Francisco, CA",
    "maxSalary": 120000,
    "status": "Applied",
    "deadline": "2024-02-15T23:59:59.000Z",
    "dateApplied": "2024-01-15T10:30:00.000Z",
    "followUp": "2024-01-22T10:00:00.000Z",
    "comment": "Applied through LinkedIn",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
]
```

### 3. Get Specific Job Application
**GET** `/api/jobs/:id`

Retrieves a specific job application by ID.

**Response (200):**
```json
{
  "id": 1,
  "userId": "user123",
  "position": "Software Engineer",
  "company": "Tech Corp",
  "location": "San Francisco, CA",
  "maxSalary": 120000,
  "status": "Applied",
  "deadline": "2024-02-15T23:59:59.000Z",
  "dateApplied": "2024-01-15T10:30:00.000Z",
  "followUp": "2024-01-22T10:00:00.000Z",
  "comment": "Applied through LinkedIn",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### 4. Update Job Application
**PUT** `/api/jobs/:id`

Updates an existing job application. Only provided fields will be updated.

**Request Body:**
```json
{
  "status": "Interview",
  "comment": "Received call for first interview"
}
```

**Response (200):**
```json
{
  "id": 1,
  "userId": "user123",
  "position": "Software Engineer",
  "company": "Tech Corp",
  "location": "San Francisco, CA",
  "maxSalary": 120000,
  "status": "Interview",
  "deadline": "2024-02-15T23:59:59.000Z",
  "dateApplied": "2024-01-15T10:30:00.000Z",
  "followUp": "2024-01-22T10:00:00.000Z",
  "comment": "Received call for first interview",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

### 5. Delete Job Application
**DELETE** `/api/jobs/:id`

Deletes a job application.

**Response (204):** No content

### 6. Get Job Application Statistics
**GET** `/api/jobs/stats/overview`

Retrieves statistics about the user's job applications.

**Response (200):**
```json
{
  "total": 15,
  "applied": 8,
  "interview": 4,
  "rejected": 2,
  "accepted": 1
}
```

### 7. Get Jobs by Status
**GET** `/api/jobs/status/:status`

Retrieves all job applications with a specific status.

**Response (200):**
```json
[
  {
    "id": 1,
    "userId": "user123",
    "position": "Software Engineer",
    "company": "Tech Corp",
    "location": "San Francisco, CA",
    "status": "Applied",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
]
```

### 8. Get Upcoming Follow-ups
**GET** `/api/jobs/follow-ups`

Retrieves job applications with follow-up dates in the next 7 days.

**Response (200):**
```json
[
  {
    "id": 1,
    "userId": "user123",
    "position": "Software Engineer",
    "company": "Tech Corp",
    "location": "San Francisco, CA",
    "followUp": "2024-01-22T10:00:00.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
]
```

### 9. Get Upcoming Deadlines
**GET** `/api/jobs/deadlines`

Retrieves job applications with deadlines in the next 30 days.

**Response (200):**
```json
[
  {
    "id": 1,
    "userId": "user123",
    "position": "Software Engineer",
    "company": "Tech Corp",
    "location": "San Francisco, CA",
    "deadline": "2024-02-15T23:59:59.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
]
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid input",
  "details": [
    {
      "code": "invalid_string",
      "minimum": 1,
      "type": "string",
      "inclusive": true,
      "exact": false,
      "message": "Job position is required",
      "path": ["position"]
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```

### 404 Not Found
```json
{
  "error": "Job application not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to create job application"
}
```

## Common Status Values

Recommended status values for job applications:
- `"Applied"` - Application submitted
- `"Interview"` - Interview scheduled or in progress
- `"Rejected"` - Application rejected
- `"Accepted"` - Job offer received
- `"Withdrawn"` - Application withdrawn
- `"Pending"` - Awaiting response

## Date Format

All date fields should be provided in ISO 8601 format:
- `"2024-01-15T10:30:00Z"`
- `"2024-01-15T10:30:00.000Z"`

## Setup Instructions

1. **Database Migration**: Run the Prisma migration to create the Job table:
   ```bash
   npx prisma migrate dev --name add-job-tracking
   ```

2. **Generate Prisma Client**: Regenerate the Prisma client to include the new Job model:
   ```bash
   npx prisma generate
   ```

3. **Restart Server**: Restart your application server to load the new routes.

## Usage Examples

### Creating a Job Application
```javascript
const response = await fetch('/api/jobs', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    position: 'Frontend Developer',
    company: 'Startup Inc',
    location: 'Remote',
    maxSalary: 95000,
    status: 'Applied',
    dateApplied: new Date().toISOString()
  })
});
```

### Updating Application Status
```javascript
const response = await fetch('/api/jobs/1', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    status: 'Interview',
    followUp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  })
});
```

### Getting Statistics
```javascript
const response = await fetch('/api/jobs/stats/overview', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const stats = await response.json();
console.log(`Total applications: ${stats.total}`);
``` 