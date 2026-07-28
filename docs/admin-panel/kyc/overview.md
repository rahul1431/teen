# KYC — Overview

Identity-verification review queue: submissions grouped by status (pending/under_review/approved/rejected — clickable stat cards double as filters), document thumbnails (Aadhaar front/back, selfie) fetched through an authenticated image proxy (Nginx blocks direct public access to `/uploads/kyc/`), and a review modal with a required rejection reason.

The image-proxy endpoint serving the actual document photos used to have no role restriction beyond "any authenticated admin" — fixed 2026-07-29, now requires `support` role like the review action.
