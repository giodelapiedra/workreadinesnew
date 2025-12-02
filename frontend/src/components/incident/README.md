# Incident Components

Centralized, reusable components for displaying incident details across multiple dashboards.

## 📁 Structure

```
frontend/src/components/incident/
├── types.ts              # Shared TypeScript interfaces
├── IncidentPhoto.tsx     # Photo display component
├── IncidentPhoto.css     # Photo styles
├── AiAnalysis.tsx        # AI analysis display component
├── AiAnalysis.css        # AI analysis styles
├── index.ts              # Centralized exports
└── README.md             # This file
```

## 🎯 Usage

### Import Components

```typescript
import { IncidentPhoto, AiAnalysis } from '../../../components/incident'
import type { AiAnalysisResult } from '../../../components/incident'
```

### IncidentPhoto Component

Displays incident photo with click-to-view-full-size functionality.

```tsx
{caseDetail.incident.photoUrl && (
  <IncidentPhoto photoUrl={caseDetail.incident.photoUrl} />
)}
```

**Props:**
- `photoUrl` (string, required) - URL of the incident photo (supports both direct URLs and proxy URLs)
- `altText` (string, optional) - Alt text for accessibility (default: "Incident photo")

**Features:**
- ✅ Lazy loading
- ✅ Click to view full size
- ✅ Error handling (auto-hides if image fails)
- ✅ Responsive design
- ✅ Backend proxy support

### AiAnalysis Component

Displays AI-generated incident analysis with risk level, summary, and recommendations.

```tsx
{caseDetail.incident.aiAnalysis && (
  <AiAnalysis analysis={caseDetail.incident.aiAnalysis} />
)}
```

**Props:**
- `analysis` (AiAnalysisResult, required) - AI analysis data object

**AiAnalysisResult Interface:**
```typescript
interface AiAnalysisResult {
  summary?: string              // Summary of the incident
  riskLevel?: string           // Risk level: "high", "medium", or "low"
  recommendations?: string[]    // Array of recommendations
  injuryType?: string          // Type of injury
  bodyPart?: string            // Affected body part
  [key: string]: any           // Allows additional fields
}
```

**Features:**
- ✅ Color-coded risk level badge (red/yellow/green)
- ✅ Summary text display
- ✅ Injury type and body part cards
- ✅ Numbered recommendations list
- ✅ Beautiful gradient design
- ✅ Responsive layout

## 📍 Used In

These components are currently used in:

1. **Worker Dashboard** - `frontend/src/pages/dashboard/worker/AccidentDetail.tsx`
2. **WHS Control Center** - `frontend/src/pages/dashboard/whs-control-center/WhsCaseDetail.tsx`
3. **Future:** Can be used in Clinician case details

## 🎨 Design System

Follows the project's design system standards:
- Colors: Standard palette (#0F172A, #64748B, #3B82F6, etc.)
- Spacing: Multiples of 4px (8px, 12px, 16px, 20px, 24px)
- Typography: 11px-14px with proper weights
- Borders: 1px solid #E2E8F0
- Border radius: 8px for cards, 12px for containers

## 🔧 Maintenance

**Single Source of Truth:** All incident photo and AI analysis UI logic is centralized here.

**To update:**
1. Edit the component file (IncidentPhoto.tsx or AiAnalysis.tsx)
2. Changes automatically apply to all pages using the component
3. No need to update multiple files

**Benefits:**
- ✅ DRY (Don't Repeat Yourself)
- ✅ Easy maintenance
- ✅ Consistent UI across pages
- ✅ Scalable for future features

## 🚀 Production Ready

These components are:
- ✅ TypeScript strict mode compliant
- ✅ No linter errors
- ✅ Optimized for performance
- ✅ Accessible (ARIA-compliant)
- ✅ Responsive (mobile-friendly)
- ✅ Secure (no XSS vulnerabilities)

