Oke, gua bikinin **DETAILED FLOW** dari nol. Bayangin ini kayak screenplay - setiap detik, setiap screen, setiap interaksi.

---

# 🎬 **STREAK APP - COMPLETE USER FLOW**

## 📱 **SCENE 1: First Launch (Onboarding)**

### **Screen 1.1: Landing Page**
**What User Sees:**
```
┌─────────────────────────────┐
│                             │
│         STREAK              │
│                             │
│  The habit tracker that     │
│  actually gives a damn      │
│                             │
│  [Sign up with Google]      │
│  [Sign up with Email]       │
│                             │
│  Already have account?      │
│  [Sign In]                  │
│                             │
└─────────────────────────────┘
```
**User Action:** Tap "Sign up with Google"  
**System Action:** Clerk auth → redirect to Screen 1.2

---

### **Screen 1.2: AI Personality Selection**
**What User Sees:**
```
┌─────────────────────────────┐
│  Choose Your Coach          │
│                             │
│  ┌─────────────────────┐   │
│  │  🔥 BRUTAL MODE     │   │
│  │  "No excuses.       │   │
│  │   No bullshit."     │   │
│  │                     │   │
│  │  [SELECT]           │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │  💪 COACH MODE      │   │
│  │  (Coming soon)      │   │
│  │  [LOCKED - PRO]     │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```
**User Action:** Tap "SELECT" brutal mode  
**System Action:** 
- Save `aiPersonality: "brutal"` to Convex user record
- Redirect to Screen 1.3

---

### **Screen 1.3: First Habit Setup**
**What User Sees:**
```
┌─────────────────────────────┐
│  What habit are you         │
│  building?                  │
│                             │
│  ┌─────────────────────┐   │
│  │ [Type habit here..] │   │
│  └─────────────────────┘   │
│                             │
│  Examples:                  │
│  • Go to gym 4x/week        │
│  • No phone before 9am      │
│  • Read 30 mins daily       │
│                             │
│  [CONTINUE]                 │
│                             │
└─────────────────────────────┘
```
**User Action:** Type "Go to gym 4x/week", tap CONTINUE  
**System Action:**
- Show Screen 1.4 (AI clarification)

---

### **Screen 1.4: AI Clarification (Critical!)**
**What User Sees:**
```
┌─────────────────────────────┐
│  AI COACH:                  │
│                             │
│  "Alright, so you wanna     │
│  hit the gym 4x/week.       │
│                             │
│  Few questions:             │
│                             │
│  1. Which days?             │
│     [Mon Tue Wed Thu Fri]   │
│     [Sat Sun]               │
│                             │
│  2. What counts as 'gym'?   │
│     ◯ Any workout 30+ mins  │
│     ◯ Actual gym only       │
│     ◯ Custom rules          │
│                             │
│  3. Why this habit?         │
│     (This helps me roast    │
│      you better later)      │
│     [Type why...]           │
│                             │
│  [LOCK IT IN]               │
│                             │
└─────────────────────────────┘
```
**User Action:** 
- Selects: Mon, Wed, Fri, Sat
- Picks: "Any workout 30+ mins"
- Types: "I'm tired of being skinny"

**System Action:**
- **Convex Mutation:** Create habit record:
  ```typescript
  {
    userId: "user_xxx",
    name: "Go to gym 4x/week",
    targetDays: ["mon", "wed", "fri", "sat"],
    rules: "Any workout 30+ mins",
    motivation: "I'm tired of being skinny",
    createdAt: Date.now(),
    isActive: true
  }
  ```
- Redirect to Screen 1.5

---

### **Screen 1.5: Add More Habits (Optional)**
**What User Sees:**
```
┌─────────────────────────────┐
│  Habit added ✓              │
│                             │
│  You can track up to        │
│  3 habits (Free tier)       │
│                             │
│  Current habits:            │
│  1. Go to gym 4x/week       │
│                             │
│  [+ Add another habit]      │
│                             │
│  [Skip to dashboard]        │
│                             │
└─────────────────────────────┘
```
**User Action:** Tap "Skip to dashboard"  
**System Action:** 
- Set `onboardingCompleted: true` in Convex
- Redirect to **Dashboard (Screen 2.1)**

---

## 🏠 **SCENE 2: Daily Dashboard (Main Screen)**

### **Screen 2.1: Dashboard - Day 1 (Morning)**
**Time:** 8:00 AM, Monday  
**What User Sees:**
```
┌─────────────────────────────┐
│  STREAK            [Profile]│
│                             │
│  Monday, Jan 15             │
│  ───────────────────────    │
│                             │
│  TODAY'S HABITS             │
│                             │
│  ┌─────────────────────┐   │
│  │ Go to gym 4x/week   │   │
│  │                     │   │
│  │ Target: Mon Wed Fri │   │
│  │ Sat                 │   │
│  │                     │   │
│  │ [ ] Not done yet    │   │
│  │                     │   │
│  │ Streak: 0 days 🔥   │   │
│  └─────────────────────┘   │
│                             │
│  [+ NEW HABIT] (2/3 used)   │
│                             │
│  ───────────────────────    │
│  AI CHECK-IN unlocks at     │
│  8:00 PM                    │
│                             │
└─────────────────────────────┘
```

**What User Can Do:**
- Tap the habit card → opens Screen 2.2 (Habit Detail)
- Add new habit (if <3 habits)
- Wait until 8pm for AI check-in

**Data in Convex (real-time):**
```typescript
habits: [{
  id: "hab_001",
  name: "Go to gym 4x/week",
  targetDays: ["mon", "wed", "fri", "sat"],
  currentStreak: 0
}]

checkIns: [] // No check-ins yet
```

---

### **Screen 2.2: Habit Detail View**
**What User Sees:**
```
┌─────────────────────────────┐
│  < Back                     │
│                             │
│  Go to gym 4x/week          │
│  ───────────────────────    │
│                             │
│  CURRENT WEEK               │
│  Mon Tue Wed Thu Fri Sat Sun│
│  ⬜  ⬜  ⬜  ⬜  ⬜  ⬜  ⬜ │
│                             │
│  STREAK: 0 days 🔥          │
│  Best streak: 0 days        │
│                             │
│  HISTORY                    │
│  (Calendar view - empty)    │
│                             │
│  [EDIT HABIT]               │
│  [DELETE HABIT]             │
│                             │
└─────────────────────────────┘
```

**User Action:** Back to dashboard  

---

### **Screen 2.3: Dashboard - Day 1 (Evening, 8:00 PM)**

**PUSH NOTIFICATION:**
```
🔥 STREAK
"Yo. Did you hit the gym today or nah?"
[Open app]
```

**User taps notification → App opens:**
```
┌─────────────────────────────┐
│  STREAK            [Profile]│
│                             │
│  Monday, Jan 15 - 8:03 PM   │
│  ───────────────────────    │
│                             │
│  ┌─────────────────────┐   │
│  │ 🤖 AI CHECK-IN      │   │
│  │                     │   │
│  │ "Alright, Monday's  │   │
│  │  almost over.       │   │
│  │                     │   │
│  │  Did you hit the    │   │
│  │  gym today?"        │   │
│  │                     │   │
│  │  [YES, I DID ✓]     │   │
│  │  [NO, I DIDN'T ✗]   │   │
│  │  [NEED MORE TIME]   │   │
│  │                     │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

---

### **SCENARIO A: User taps "YES, I DID ✓"**

**Screen changes to:**
```
┌─────────────────────────────┐
│  🤖 AI RESPONSE:            │
│                             │
│  "Aight, Day 1 done.        │
│                             │
│  Don't get cocky tho.       │
│  One workout don't mean     │
│  shit yet.                  │
│                             │
│  See you Wednesday.         │
│  Don't flake."              │
│                             │
│  ✓ Logged as completed      │
│                             │
│  [BACK TO DASHBOARD]        │
│                             │
└─────────────────────────────┘
```

**System Action (Convex Mutation):**
```typescript
// Create check-in record
{
  habitId: "hab_001",
  userId: "user_xxx",
  date: "2025-01-15",
  status: "completed",
  aiResponse: "Aight, Day 1 done...",
  timestamp: Date.now()
}

// Update habit streak
{
  currentStreak: 1,
  lastCompletedDate: "2025-01-15"
}
```

**Dashboard Updates (real-time via Convex subscription):**
```
┌─────────────────────────────┐
│  Monday, Jan 15 - 8:05 PM   │
│  ───────────────────────    │
│                             │
│  TODAY'S HABITS             │
│                             │
│  ┌─────────────────────┐   │
│  │ Go to gym 4x/week   │   │
│  │                     │   │
│  │ ✓ Completed today   │   │
│  │                     │   │
│  │ Streak: 1 day 🔥    │   │
│  │                     │   │
│  │ Next: Wednesday     │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

---

### **SCENARIO B: User taps "NO, I DIDN'T ✗"**

**AI asks follow-up:**
```
┌─────────────────────────────┐
│  🤖 AI:                     │
│                             │
│  "Already? It's Day 1       │
│  and you're already         │
│  skipping?                  │
│                             │
│  What's the excuse?"        │
│                             │
│  [Type your reason...]      │
│  ___________________        │
│                             │
│  [SUBMIT]                   │
│                             │
└─────────────────────────────┘
```

**User types:** "I was too tired after work"

**AI Response:**
```
┌─────────────────────────────┐
│  🤖 AI:                     │
│                             │
│  "Too tired? Nah bro.       │
│                             │
│  You said you're tired      │
│  of being skinny. But       │
│  you're too tired to        │
│  actually do something?     │
│                             │
│  Pick one - tired of        │
│  being skinny, or too       │
│  tired to fix it.           │
│                             │
│  Wednesday. No excuses."    │
│                             │
│  ✗ Logged as missed         │
│                             │
│  [BACK TO DASHBOARD]        │
│                             │
└─────────────────────────────┘
```

**System Action (Convex):**
```typescript
{
  habitId: "hab_001",
  date: "2025-01-15",
  status: "missed",
  userReason: "I was too tired after work",
  aiResponse: "Too tired? Nah bro...",
  timestamp: Date.now()
}

// Streak remains 0
```

---

## 📅 **SCENE 3: Day 2 (Tuesday - Non-Target Day)**

### **Screen 3.1: Dashboard - Tuesday Morning**
```
┌─────────────────────────────┐
│  Tuesday, Jan 16            │
│  ───────────────────────    │
│                             │
│  TODAY'S HABITS             │
│                             │
│  ┌─────────────────────┐   │
│  │ Go to gym 4x/week   │   │
│  │                     │   │
│  │ 🔵 Rest day         │   │
│  │ (Not scheduled for  │   │
│  │  Tuesday)           │   │
│  │                     │   │
│  │ Streak: 0 days      │   │
│  │ (Broken yesterday)  │   │
│  │                     │   │
│  │ Next: Wednesday     │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

**No AI check-in today** (not a target day)

**User can:**
- Tap "Log bonus workout" (if they go anyway - optional feature)
- Just chill

---

## 📅 **SCENE 4: Day 3 (Wednesday - Target Day)**

### **Screen 4.1: Dashboard - Wednesday 8pm**

**Push Notification:**
```
🔥 STREAK
"Wednesday. You said no excuses. Prove it."
```

**User opens → Same check-in flow**

**If user completes:**
```
AI: "Okay, streak back to 1. 
     Let's see if you can keep this up."
```

**If user misses again:**
```
AI: "Two misses in one week? 
     And you wonder why nothing changes.
     
     You want me to lower the target to 3x/week?
     Or you ready to actually commit?"
     
     [LOWER TARGET]  [KEEP 4X/WEEK]
```

**This is key** → AI adapts to patterns!

---

## 📊 **SCENE 5: Week 1 Review (Sunday Night)**

### **Screen 5.1: Weekly Roast Report**

**Push Notification at 9pm:**
```
🔥 STREAK - WEEKLY ROAST
"Week 1 is done. Let's talk about it."
```

**User opens:**
```
┌─────────────────────────────┐
│  WEEK 1 REVIEW              │
│  Jan 15 - Jan 21            │
│  ───────────────────────    │
│                             │
│  Go to gym 4x/week          │
│  ═══════════════════════    │
│                             │
│  TARGET: 4 workouts         │
│  ACTUAL: 2 workouts         │
│                             │
│  Mon ✓  Tue -  Wed ✗        │
│  Thu -  Fri ✓  Sat ✗  Sun - │
│                             │
│  ───────────────────────    │
│                             │
│  🤖 AI ROAST:               │
│                             │
│  "You hit 50%. That's       │
│  literally half-assing it.  │
│                             │
│  You missed Wednesday       │
│  because 'tired'. You       │
│  missed Saturday because    │
│  'busy with friends'.       │
│                             │
│  Notice a pattern? You      │
│  bail when it's slightly    │
│  inconvenient.              │
│                             │
│  Week 2 starts tomorrow.    │
│  Either commit or quit.     │
│  Don't waste my time."      │
│                             │
│  [VIEW FULL STATS]          │
│  [ADJUST HABIT]             │
│                             │
└─────────────────────────────┘
```

**Convex stores:**
```typescript
weeklyReports: [{
  userId: "user_xxx",
  habitId: "hab_001",
  weekStart: "2025-01-15",
  weekEnd: "2025-01-21",
  targetCount: 4,
  actualCount: 2,
  completionRate: 0.5,
  aiRoast: "You hit 50%...",
  missedDaysReasons: [
    { day: "wed", reason: "too tired" },
    { day: "sat", reason: "busy with friends" }
  ]
}]
```

---

## 🎯 **SCENE 6: Month 1 Complete (Special Milestone)**

**If user hits 80%+ consistency for 4 weeks:**

```
┌─────────────────────────────┐
│  🏆 MONTH 1 COMPLETE        │
│  ═══════════════════════    │
│                             │
│  Go to gym 4x/week          │
│                             │
│  STATS:                     │
│  • Target: 16 workouts      │
│  • Actual: 14 workouts      │
│  • Consistency: 87.5%       │
│  • Best streak: 9 days      │
│                             │
│  ───────────────────────    │
│                             │
│  🤖 AI:                     │
│                             │
│  "Aight, I'll give credit   │
│  where it's due.            │
│                             │
│  You actually stuck with    │
│  it. 87% is solid.          │
│                             │
│  But don't get comfortable. │
│  Month 2 is when it gets    │
│  harder. Most people quit   │
│  around week 6.             │
│                             │
│  You gonna be different?"   │
│                             │
│  [SHARE PROGRESS]           │
│  [VIEW ALL-TIME STATS]      │
│                             │
└─────────────────────────────┘
```

---

## 🔐 **SCENE 7: Free vs Pro Tier**

### **Screen 7.1: Hit Free Limit**

**User tries to add 4th habit:**
```
┌─────────────────────────────┐
│  UPGRADE TO PRO             │
│  ───────────────────────    │
│                             │
│  You've reached the free    │
│  limit of 3 habits.         │
│                             │
│  STREAK PRO unlocks:        │
│  ✓ Unlimited habits         │
│  ✓ Advanced analytics       │
│  ✓ Custom AI personality    │
│  ✓ Export data              │
│  ✓ Priority support         │
│                             │
│  $9.99/month                │
│                             │
│  [UPGRADE NOW]              │
│  [MAYBE LATER]              │
│                             │
└─────────────────────────────┘
```

**Tap "UPGRADE NOW"** → Polar.sh checkout flow → Redirect back → Pro features unlocked

---

## 🎨 **UI MOCKUPS (Brutalist Design)**

**Color Palette:**
```
Background: #000000 (pure black)
Text: #FFFFFF (pure white)
Accent (streaks): #FF0000 (red)
Secondary: #333333 (dark gray)
Success: #00FF00 (green, sparingly)
```

**Typography:**
```
Headings: JetBrains Mono (monospace)
Body: Inter (clean sans-serif)
AI text: Courier New (feels like terminal)
```

**Button Style:**
```
┌─────────────┐
│ CONTINUE    │ ← Hard edges, no rounded corners
└─────────────┘
   White text on black background
   Red border on hover
```

---

## 🔧 **TECHNICAL IMPLEMENTATION (Convex Schema)**

```typescript
// convex/schema.ts

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    aiPersonality: v.union(v.literal("brutal"), v.literal("coach")),
    subscriptionTier: v.union(v.literal("free"), v.literal("pro")),
    onboardingCompleted: v.boolean(),
  }).index("by_clerk_id", ["clerkId"]),

  habits: defineTable({
    userId: v.id("users"),
    name: v.string(),
    targetDays: v.array(v.string()), // ["mon", "wed", "fri", "sat"]
    rules: v.string(), // "Any workout 30+ mins"
    motivation: v.string(), // User's why
    currentStreak: v.number(),
    bestStreak: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  checkIns: defineTable({
    habitId: v.id("habits"),
    userId: v.id("users"),
    date: v.string(), // "2025-01-15"
    status: v.union(v.literal("completed"), v.literal("missed"), v.literal("bonus")),
    userReason: v.optional(v.string()), // For missed days
    aiResponse: v.string(),
    timestamp: v.number(),
  })
    .index("by_habit", ["habitId"])
    .index("by_user_date", ["userId", "date"]),

  weeklyReports: defineTable({
    userId: v.id("users"),
    habitId: v.id("habits"),
    weekStart: v.string(),
    weekEnd: v.string(),
    targetCount: v.number(),
    actualCount: v.number(),
    completionRate: v.number(),
    aiRoast: v.string(),
    missedDaysReasons: v.array(
      v.object({
        day: v.string(),
        reason: v.string(),
      })
    ),
  }).index("by_user", ["userId"]),
});
```

---

## 🤖 **AI LOGIC (How Roasting Works)**

**AI Prompt Template (sent to Claude via API in artifact):**

```typescript
const generateAIResponse = async (context: {
  habitName: string;
  targetDays: string[];
  status: "completed" | "missed";
  currentStreak: number;
  userReason?: string;
  motivation: string;
  recentHistory: CheckIn[];
}) => {
  const prompt = `You are a brutal fitness coach. No sugarcoating.
  
Context:
- User's habit: ${context.habitName}
- Motivation: ${context.motivation}
- Current streak: ${context.currentStreak}
- Today's status: ${context.status}
${context.userReason ? `- User's excuse: "${context.userReason}"` : ""}

Recent pattern:
${context.recentHistory.map(h => `${h.date}: ${h.status}`).join("\n")}

Rules:
1. Keep response under 50 words
2. Be brutally honest but not mean
3. Reference their motivation when they miss
4. Acknowledge progress when they're consistent
5. Call out patterns (e.g., "You always skip Fridays")

Respond as the coach:`;

  // Call Anthropic API (in artifact)
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  return response.data.content[0].text;
};
```

---

## ✅ **UPDATED BUILD PROTOCOL - PRE-FLIGHT CHECKLIST**

```
APP NAME: Streak

ONE-SENTENCE PITCH: A brutalist habit tracker with an AI coach that roasts you into consistency

UI AESTHETIC: Pure black background (#000000), white text, red accents for streaks, monospace fonts, hard edges (no rounded corners), Vercel/Linear minimalism

DEPLOYMENT TARGET: Vercel

CORE BUSINESS ENTITIES:

1. USER PROFILE
   - Syncs with Clerk authentication
   - Tracks: Polar.sh subscription tier (Free/Pro), AI personality, onboarding status
   
2. HABITS
   - Belongs to: User (via userId)
   - Fields: name, targetDays (array), rules, motivation, currentStreak, bestStreak, isActive, createdAt
   - Constraints: Max 3 habits for free tier, unlimited for pro
   
3. CHECK-INS
   - Belongs to: Habit + User
   - Fields: date, status (completed/missed/bonus), userReason, aiResponse, timestamp
   - Used for: Daily tracking, AI response generation
   
4. WEEKLY REPORTS
   - Belongs to: User + Habit
   - Fields: weekStart, weekEnd, targetCount, actualCount, completionRate, aiRoast, missedDaysReasons
   - Generated: Every Sunday at 9pm

SPECIAL FEATURES/REQUIREMENTS:
- Real-time streak updates (Convex subscriptions)
- Daily AI check-ins at 8pm (push notifications via Convex scheduled functions)
- Weekly roast reports with pattern analysis
- AI personality: Brutal coach mode (using Claude API in artifact)
- Export data to CSV (Pro feature)
- Dark mode only (no light mode option)
```

---

**YANG MASIH KURANG:**

1. **Push notifications** - perlu setup service worker atau Convex cron jobs
2. **Timezone handling** - user di timezone berbeda, check-in jam 8pm lokal mereka
3. **Onboarding skip logic** - kalo user udah pernah pake app sebelumnya
4. **Social features?** - share streak ke Twitter/IG? (optional)

**READY BUAT BUILD?** Kalo flow ini udah jelas, gua bisa:
1. Update protocol dengan detail ini
2. Langsung mulai Phase 1a
3. Atau lu mau adjust dulu?


