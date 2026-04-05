# 🔥 **STREAK APP - COMPLETE USER FLOW (FINAL VERSION)**

*Hybrid approach: Dashboard untuk quick actions + Chat untuk conversations + AI proaktif sepanjang hari*

---

## 📱 **SCENE 1: FIRST LAUNCH (ONBOARDING)**

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
**System Action:** Save `aiPersonality: "brutal"` to Convex → Screen 1.3

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
**System Action:** → Screen 1.4

---

### **Screen 1.4: AI Clarification (Critical Setup)**
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
│     [Mon] [Tue] [Wed] [Thu] │
│     [Fri] [Sat] [Sun]       │
│                             │
│  2. What time you usually   │
│     go?                     │
│     [Morning 6-10am]        │
│     [Afternoon 2-6pm]       │
│     [Evening 6-10pm]        │
│     [Custom time]           │
│                             │
│  3. What counts as 'gym'?   │
│     ◯ Any workout 30+ mins  │
│     ◯ Actual gym only       │
│                             │
│  4. Why this habit?         │
│     [Type why...]           │
│                             │
│  [LOCK IT IN]               │
│                             │
└─────────────────────────────┘
```

**User Fills Out:**
- Days: Mon, Wed, Fri, Sat (tap to toggle)
- Time: Afternoon 2-6pm
- Rules: Any workout 30+ mins
- Why: "I'm tired of being skinny"

**User Action:** Tap "LOCK IT IN"

**System shows confirmation:**
```
┌─────────────────────────────┐
│  AI COACH:                  │
│                             │
│  "Got it. So here's the     │
│  deal:                      │
│                             │
│  Target: Gym 4x/week        │
│  Days: Mon/Wed/Fri/Sat      │
│  Time: Around 5pm           │
│                             │
│  I'll remind you 1 hour     │
│  before (4pm).              │
│                             │
│  If you don't check in by   │
│  6:30pm, I'm coming for     │
│  you.                       │
│                             │
│  Sound good?"               │
│                             │
│  [YES, LET'S GO]            │
│  [ADJUST TIME]              │
│                             │
└─────────────────────────────┘
```

**User Action:** Tap "YES, LET'S GO"

**System Action (Convex Mutation):**
```typescript
habits.insert({
  userId: "user_xxx",
  name: "Go to gym 4x/week",
  targetDays: ["mon", "wed", "fri", "sat"],
  scheduledTime: "17:00", // 5pm
  reminderTime: "16:00", // 4pm
  checkInDeadline: "18:30", // 6:30pm
  rules: "Any workout 30+ mins",
  motivation: "I'm tired of being skinny",
  currentStreak: 0,
  bestStreak: 0,
  isActive: true,
  createdAt: Date.now()
})
```

**Redirect to:** Screen 1.5

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
│  [Go to dashboard]          │
│                             │
└─────────────────────────────┘
```

**User Action:** Tap "Go to dashboard"  
**System Action:** Set `onboardingCompleted: true` → **Dashboard (Screen 2.1)**

---

## 🏠 **SCENE 2: MAIN DASHBOARD (HOME SCREEN)**

### **Screen 2.1: Dashboard - Day 1 Morning (Monday, 8:00 AM)**

**Bottom Navigation:**
```
┌─────────────────────────────┐
│                             │
│   [Main Content Area]       │
│                             │
│                             │
└─────────────────────────────┘
  📊 Home  💬 Chat  👤 Profile
```

**Home Tab Content:**
```
┌─────────────────────────────┐
│  STREAK            [Profile]│
│                             │
│  Monday, Jan 15             │
│  8:03 AM                    │
│  ───────────────────────    │
│                             │
│  TODAY'S HABITS             │
│                             │
│  ┌─────────────────────┐   │
│  │ Go to gym 4x/week   │   │
│  │                     │   │
│  │ 🎯 Scheduled: 5pm   │   │
│  │                     │   │
│  │ [ ] Not done yet    │   │
│  │                     │   │
│  │ Streak: 0 days      │   │
│  │                     │   │
│  │ [Mark Complete]     │   │
│  │ [💬 Chat with AI]   │   │
│  └─────────────────────┘   │
│                             │
│  [+ NEW HABIT] (1/3 used)   │
│                             │
│  ───────────────────────    │
│  💬 AI will remind you at   │
│     4:00 PM                 │
│                             │
└─────────────────────────────┘
```

**What User Can Do:**
- View today's schedule
- Tap habit card → Habit Detail (Screen 2.2)
- Tap "Mark Complete" → Quick check-in (Screen 2.3)
- Tap "Chat with AI" → Open Chat tab (Screen 2.4)
- Add new habit

**Convex Data (Real-time):**
```typescript
habits: [{
  id: "hab_001",
  name: "Go to gym 4x/week",
  scheduledTime: "17:00",
  currentStreak: 0
}]

reminders: [{
  habitId: "hab_001",
  scheduledFor: 1705334400000, // 4pm today
  type: "pre_workout",
  sent: false
}]
```

---

### **Screen 2.2: Habit Detail View**
**User taps habit card → sees:**
```
┌─────────────────────────────┐
│  < Back                     │
│                             │
│  Go to gym 4x/week          │
│  ───────────────────────    │
│                             │
│  CURRENT WEEK               │
│  Mon Tue Wed Thu Fri Sat Sun│
│  ⬜  -   ⬜  -   ⬜  ⬜  -  │
│                             │
│  (- = rest day)             │
│                             │
│  STREAK: 0 days 🔥          │
│  Best streak: 0 days        │
│                             │
│  SCHEDULE                   │
│  • Target time: 5:00 PM     │
│  • Reminder: 4:00 PM        │
│  • Deadline: 6:30 PM        │
│                             │
│  HISTORY                    │
│  (No workouts yet)          │
│                             │
│  [EDIT HABIT]               │
│  [DELETE HABIT]             │
│                             │
└─────────────────────────────┘
```

---

### **Screen 2.3: Quick Check-In (Dashboard Button)**
**User taps "Mark Complete" from dashboard:**
```
┌─────────────────────────────┐
│  Quick Check-In             │
│  ───────────────────────    │
│                             │
│  Did you complete:          │
│  "Go to gym 4x/week"        │
│  today?                     │
│                             │
│  [✓ YES, COMPLETED]         │
│  [✗ NO, MISSED]             │
│  [💬 CHAT INSTEAD]          │
│                             │
└─────────────────────────────┘
```

**If user taps "YES, COMPLETED":**
```
┌─────────────────────────────┐
│  ✓ Logged as completed      │
│                             │
│  🤖 AI says:                │
│  "Aight, Day 1 done.        │
│                             │
│   Don't get cocky tho.      │
│   One workout don't mean    │
│   shit yet.                 │
│                             │
│   See you Wednesday."       │
│                             │
│  Streak: 1 day 🔥           │
│                             │
│  [BACK TO DASHBOARD]        │
│                             │
└─────────────────────────────┘
```

**Convex Mutation:**
```typescript
checkIns.insert({
  habitId: "hab_001",
  userId: "user_xxx",
  date: "2025-01-15",
  status: "completed",
  source: "dashboard_quick",
  aiResponse: "Aight, Day 1 done...",
  timestamp: Date.now()
})

habits.patch("hab_001", {
  currentStreak: 1,
  lastCompletedDate: "2025-01-15"
})
```

---

### **Screen 2.4: Chat Tab (Alternative Interface)**
**User taps "Chat with AI" OR switches to Chat tab:**
```
┌─────────────────────────────┐
│  💬 CHAT        [Clear All] │
│  ───────────────────────    │
│                             │
│  [8:05 AM]                  │
│  🤖: "Morning. You got      │
│      gym scheduled at 5pm   │
│      today.                 │
│                             │
│      I'll check on you      │
│      later."                │
│                             │
│                             │
│  ┌─────────────────────┐   │
│  │ Type message...     │   │
│  │                     │   │
│  └─────────────────────┘   │
│  ────────────────── [Send]  │
│                             │
│  Quick actions:             │
│  [Mark gym done] [Ask AI]   │
│                             │
└─────────────────────────────┘
  📊 Home  💬 Chat  👤 Profile
```

**User can:**
- Type any message to AI
- Use quick action buttons
- View conversation history

---

## ⏰ **SCENE 3: AI PROACTIVE THROUGHOUT DAY**

### **Moment 1: Pre-Workout Reminder (4:00 PM)**

**PUSH NOTIFICATION:**
```
🔥 STREAK
"Gym in 1 hour. You ready or you got excuses already?"
[Open app]
```

**User taps notification → App opens to Chat tab:**
```
┌─────────────────────────────┐
│  💬 CHAT        [Clear All] │
│  ───────────────────────    │
│                             │
│  [Previous messages...]     │
│                             │
│  [4:00 PM]                  │
│  🤖: "Gym in 1 hour.        │
│                             │
│      You ready or you got   │
│      excuses already?"      │
│                             │
│  ┌─────────────────────┐   │
│  │ Type reply...       │   │
│  └─────────────────────┘   │
│  ────────────────── [Send]  │
│                             │
│  Quick reply:               │
│  [Yeah I'm going]           │
│  [Can't today]              │
│                             │
└─────────────────────────────┘
```

---

### **SCENARIO A: User Commits via Chat**

**User taps "Yeah I'm going":**
```
[4:01 PM]
👤: "Yeah I'm going"

[4:01 PM]
🤖: "Bet. I'll check on you
     at 6.
     
     Don't forget your water
     bottle."
```

**System Action:**
```typescript
messages.insert({
  userId: "user_xxx",
  role: "user",
  content: "Yeah I'm going",
  timestamp: Date.now()
})

messages.insert({
  userId: "user_xxx",
  role: "ai",
  content: "Bet. I'll check on you at 6...",
  timestamp: Date.now()
})

// Schedule follow-up reminder
reminders.insert({
  habitId: "hab_001",
  scheduledFor: 1705341600000, // 6pm
  type: "check_in",
  sent: false
})
```

---

### **Moment 2: Check-In Time (6:00 PM)**

**PUSH NOTIFICATION:**
```
🔥 STREAK
"It's 6. You at the gym?"
[Reply]
```

**User opens chat:**
```
┌─────────────────────────────┐
│  💬 CHAT                    │
│  ───────────────────────    │
│                             │
│  [Previous conversation...] │
│                             │
│  [6:00 PM]                  │
│  🤖: "It's 6. You at the    │
│      gym?"                  │
│                             │
│  ┌─────────────────────┐   │
│  │ Type reply...       │   │
│  └─────────────────────┘   │
│  [Send]                     │
│                             │
│  Quick reply:               │
│  [Yeah just finished]       │
│  [Still here]               │
│  [Didn't go]                │
│                             │
└─────────────────────────────┘
```

**User types:** "yeah bro just finished, legs are dead"

**AI extracts info + responds:**
```
[6:02 PM]
👤: "yeah bro just finished,
     legs are dead"

[6:02 PM]
🤖: "What'd you hit?"
```

**User types:** "squats 4x8, leg press 3x12"

```
[6:03 PM]
👤: "squats 4x8, leg press
     3x12"

[6:03 PM]
🤖: "Solid. Logged as
     completed.
     
     Streak: 1 day 🔥
     
     Next gym day:
     Wednesday 5pm.
     
     Don't flake."
```

**System Action (AI Extraction + Logging):**
```typescript
// AI parses message, extracts structured data
const extractedData = await extractWorkoutData(
  "squats 4x8, leg press 3x12"
)
// Returns: {
//   exercises: [
//     { name: "squats", sets: 4, reps: 8 },
//     { name: "leg press", sets: 3, reps: 12 }
//   ]
// }

checkIns.insert({
  habitId: "hab_001",
  date: "2025-01-15",
  status: "completed",
  source: "chat",
  conversationSummary: "User did leg workout",
  timestamp: Date.now()
})

workoutLogs.insert({
  habitId: "hab_001",
  exercises: extractedData.exercises,
  notes: "legs are dead"
})

habits.patch("hab_001", {
  currentStreak: 1
})
```

**Dashboard auto-updates (real-time via Convex):**
```
┌─────────────────────────────┐
│  Monday, Jan 15 - 6:05 PM   │
│  ───────────────────────    │
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

### **SCENARIO B: User Misses (6:00 PM Check-In)**

**User replies:** "nah bro i'm too tired, long day at work"

```
[6:01 PM]
👤: "nah bro i'm too tired,
     long day at work"

[6:01 PM]
🤖: "Too tired huh?
     
     That's what you said
     you wanted to avoid.
     Being tired of being
     skinny, remember?
     
     But you're too tired
     to fix it?
     
     Real talk - you wanna
     lower this to 3x/week
     or you gonna commit?"
     
[KEEP 4X/WEEK] [LOWER TO 3X]
```

**If user taps "KEEP 4X/WEEK":**
```
[6:02 PM]
👤: [Selected: Keep 4x/week]

[6:02 PM]
🤖: "Alright. Wednesday then.
     
     No excuses this time."
```

**System Action:**
```typescript
checkIns.insert({
  habitId: "hab_001",
  date: "2025-01-15",
  status: "missed",
  source: "chat",
  userReason: "too tired, long day at work",
  aiResponse: "Too tired huh?...",
  timestamp: Date.now()
})

// Streak stays at 0
```

---

### **SCENARIO C: User Late Reply (6:30 PM Deadline Passed)**

**User doesn't reply by 6:30pm.**

**AI sends follow-up at 6:35pm:**
```
PUSH NOTIFICATION:
🔥 STREAK
"Yo. You ghosting me? That's an automatic miss."
```

**User opens app (7:00 PM):**
```
[6:35 PM]
🤖: "Yo. You ghosting me?
     
     It's past 6:30. That's
     an automatic miss.
     
     Streak broken."

[7:01 PM]
👤: "sorry bro fell asleep"

[7:02 PM]
🤖: "Fell asleep before gym?
     
     That's a new one.
     
     Anyway, Monday's done.
     You missed it.
     
     Wednesday. Don't fuck
     this up again."
```

**System logged as missed at 6:35pm (deadline):**
```typescript
checkIns.insert({
  habitId: "hab_001",
  date: "2025-01-15",
  status: "missed",
  source: "auto_deadline",
  userReason: "No response by deadline",
  aiResponse: "Yo. You ghosting me?...",
  timestamp: Date.now()
})
```

---

## 📅 **SCENE 4: NON-TARGET DAY (Tuesday)**

### **Screen 4.1: Dashboard - Tuesday Morning**
```
┌─────────────────────────────┐
│  Tuesday, Jan 16            │
│  9:12 AM                    │
│  ───────────────────────    │
│                             │
│  TODAY'S HABITS             │
│                             │
│  ┌─────────────────────┐   │
│  │ Go to gym 4x/week   │   │
│  │                     │   │
│  │ 🔵 Rest day         │   │
│  │ (Not scheduled)     │   │
│  │                     │   │
│  │ Streak: 0 days      │   │
│  │ (Broken yesterday)  │   │
│  │                     │   │
│  │ Next: Wednesday 5pm │   │
│  │                     │   │
│  │ [Log bonus workout] │   │
│  │ [💬 Chat with AI]   │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

**No push notifications today** (not a target day)

**User can optionally:**
- Chat with AI about anything
- Log a bonus workout (counts toward stats but doesn't affect target)

---

### **SCENARIO: User Does Bonus Workout**

**User opens chat, types:** "yo should I do a bonus workout today?"

```
[2:15 PM]
👤: "yo should I do a bonus
     workout today?"

[2:15 PM]
🤖: "Tuesday's not scheduled,
     but hell yeah - bonus
     workouts count.
     
     What you thinking? Full
     workout or just cardio?"

[2:16 PM]
👤: "maybe just 20 mins cardio"

[2:16 PM]
🤖: "Do it. I'll wait for
     you to check back in."
```

**User (45 mins later):**
```
[3:01 PM]
👤: "done, ran 3km"

[3:01 PM]
🤖: "Bonus workout logged ✓
     
     That's discipline right
     there. Most people rest
     on rest days.
     
     Keep this energy for
     Wednesday."
```

**System Action:**
```typescript
checkIns.insert({
  habitId: "hab_001",
  date: "2025-01-16",
  status: "bonus", // Special status
  source: "chat",
  conversationSummary: "Bonus cardio - 3km run",
  timestamp: Date.now()
})

workoutLogs.insert({
  habitId: "hab_001",
  exercises: [{ name: "running", duration: 20, distance: 3 }],
  notes: "Bonus rest day workout"
})

// Streak doesn't increase (not a target day)
// But shows in stats as bonus effort
```

---

## 🎯 **SCENE 5: USER-INITIATED CHAT (Asking for Help)**

### **Wednesday Morning - User Asks Question**

**User opens chat (10:00 AM):**
```
[10:03 AM]
👤: "bro why do i keep
     skipping fridays"

[10:03 AM]
🤖: "Let me check your
     history.
     
     [analyzing...]"
```

**AI queries Convex, analyzes pattern:**
```typescript
// AI function call
const fridayCheckIns = await ctx.db
  .query("checkIns")
  .filter(q => 
    q.and(
      q.eq(q.field("habitId"), habitId),
      // Last 4 Fridays
    )
  )
  .collect()

// Returns: [missed, missed, missed, completed]
```

**AI responds with insights:**
```
[10:04 AM]
🤖: "Okay so:
     
     Last 4 Fridays:
     • 3 missed, 1 completed
     
     Your excuses:
     • 'tired' (2x)
     • 'friends invited
       me out' (1x)
     
     Pattern: You schedule
     gym at 5pm Fridays, but
     that's when your social
     life kicks in.
     
     Solution: Move Friday
     gym to morning (7am)
     instead?"
     
[TRY MORNING] [KEEP 5PM]
```

**User taps "TRY MORNING":**
```
[10:05 AM]
👤: [Selected: Try morning]

[10:05 AM]
🤖: "Bet. Updated Friday
     gym to 7am.
     
     I'll remind you at 6am
     this Friday.
     
     No excuses about being
     tired - you'll be fresh
     in the morning."
```

**System updates:**
```typescript
habits.patch("hab_001", {
  schedules: {
    fri: {
      scheduledTime: "07:00",
      reminderTime: "06:00",
      checkInDeadline: "08:30"
    }
  }
})
```

---

## 📊 **SCENE 6: STATS TAB (Visual Dashboard)**

**User switches to Stats tab:**
```
┌─────────────────────────────┐
│  📊 STATS       [This Week] │
│  ───────────────────────    │
│                             │
│  Go to gym 4x/week          │
│  ═══════════════════════    │
│                             │
│  Mon Tue Wed Thu Fri Sat Sun│
│  ✓   +   ✓   -   ✗   ✓   - │
│                             │
│  ✓ = completed              │
│  ✗ = missed                 │
│  + = bonus                  │
│  - = rest day               │
│                             │
│  CURRENT STREAK: 5 days 🔥  │
│  Best streak: 5 days        │
│                             │
│  THIS WEEK: 3/4 (75%)       │
│  Bonus workouts: 1          │
│                             │
│  ───────────────────────    │
│  RECENT WORKOUTS            │
│                             │
│  ┌─────────────────────┐   │
│  │ Sat Jan 20          │   │
│  │ Upper body          │   │
│  │ • Bench press 4x10  │   │
│  │ • Rows 3x12         │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │ Wed Jan 17          │   │
│  │ Legs                │   │
│  │ • Squats 4x8        │   │
│  │ • Leg press 3x12    │   │
│  └─────────────────────┘   │
│                             │
│  [VIEW CALENDAR]            │
│  [VIEW ALL LOGS]            │
│                             │
└─────────────────────────────┘
  📊 Home  💬 Chat  👤 Profile
```

**Stats Tab = Read-only, no interactions**  
**All actions happen in Home or Chat tabs**

---

## 🗓️ **SCENE 7: WEEKLY REVIEW (Sunday Night)**

### **Sunday 9:00 PM - AI Generates Report**

**PUSH NOTIFICATION:**
```
🔥 STREAK - WEEKLY ROAST
"Week 1 is done. Let's talk about it."
[Open]
```

**User opens → Chat tab shows:**
```
┌─────────────────────────────┐
│  💬 CHAT                    │
│  ───────────────────────    │
│                             │
│  [9:00 PM - Sunday]         │
│  🤖: "WEEK 1 REVIEW         │
│      ───────────────        │
│                             │
│      Target: 4 workouts     │
│      Actual: 2 workouts     │
│      Bonus: 1 workout       │
│                             │
│      Mon ✓  Tue +  Wed ✗    │
│      Thu -  Fri ✓  Sat ✗    │
│      Sun -                  │
│                             │
│      You hit 50%. That's    │
│      literally half-        │
│      assing it.             │
│                             │
│      You missed Wednesday   │
│      because 'tired'.       │
│      You missed Saturday    │
│      because 'busy with     │
│      friends'.              │
│                             │
│      Notice a pattern?      │
│      You bail when it's     │
│      slightly inconvenient. │
│                             │
│      Week 2 starts          │
│      tomorrow. Either       │
│      commit or quit.        │
│      Don't waste my time."  │
│                             │
│  [VIEW FULL STATS]          │
│  [ADJUST HABIT]             │
│                             │
└─────────────────────────────┘
```

**Convex stores:**
```typescript
weeklyReports.insert({
  userId: "user_xxx",
  habitId: "hab_001",
  weekStart: "2025-01-15",
  weekEnd: "2025-01-21",
  targetCount: 4,
  actualCount: 2,
  bonusCount: 1,
  completionRate: 0.5,
  aiRoast: "You hit 50%...",
  missedDaysReasons: [
    { day: "wed", reason: "too tired" },
    { day: "sat", reason: "busy with friends" }
  ]
})
```

---

## 🏆 **SCENE 8: MILESTONE ACHIEVEMENT (Month 1)**

**After 4 weeks of 80%+ consistency:**

**Chat tab notification:**
```
┌─────────────────────────────┐
│  [Sunday, Feb 11 - 9pm]     │
│  🤖: "MONTH 1 COMPLETE      │
│      ═══════════════        │
│                             │
│      Target: 16 workouts    │
│      Actual: 14 workouts    │
│      Consistency: 87.5%     │
│      Best streak: 9 days    │
│                             │
│      Aight, I'll give       │
│      credit where it's due. │
│                             │
│      You actually stuck     │
│      with it. 87% is solid. │
│                             │
│      But don't get          │
│      comfortable. Month 2   │
│      is when it gets        │
│      harder. Most people    │
│      quit around week 6.    │
│                             │
│      You gonna be           │
│      different?"            │
│                             │
│  [SHARE PROGRESS]           │
│  [VIEW STATS]               │
│                             │
└─────────────────────────────┘
```

---

## 🔐 **SCENE 9: FREE VS PRO LIMITS**

### **Scenario A: Message Limit Hit (Free Tier)**

**User sends 21st message of the day:**
```
[8:45 PM]
👤: "yo what should i eat
     before gym"

[8:45 PM]
🤖: "Hold up.
     
     You've hit your 20
     messages for today
     (Free tier).
     
     Upgrade to Pro for
     unlimited conversations?
     
     Or wait til tomorrow."
     
[UPGRADE $9.99/mo] [WAIT]
```

**If user taps "UPGRADE":**
- Redirect to Polar.sh checkout
- After payment → immediately unlock unlimited messages
- Confirmation in chat

---

### **Scenario B: 4th Habit (Free Tier)**

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
│  ✓ Unlimited AI messages    │
│  ✓ Advanced analytics       │
│  ✓ Export workout data      │
│  ✓ Custom AI personality    │
│                             │
│  $9.99/month                │
│                             │
│  [UPGRADE NOW]              │
│  [MAYBE LATER]              │
│                             │
└─────────────────────────────┘
```

---

## 🎨 **UI DESIGN SPECS (Brutalist Aesthetic)**

**Color Palette:**
```css
--bg-primary: #000000 (pure black)
--text-primary: #FFFFFF (pure white)
--text-secondary: #999999 (gray)
--accent-streak: #FF0000 (red for streaks)
--accent-success: #00FF00 (green, minimal use)
--accent-missed: #666666 (dark gray)
--border: #333333 (subtle borders)
```

**Typography:**
```css
--font-heading: 'JetBrains Mono', monospace
--font-body: 'Inter', sans-serif
--font-ai: 'Courier New', monospace

h1: 24px, 700 weight
h2: 18px, 700 weight
body: 16px, 400 weight
small: 14px, 400 weight
```

**Components:**
```css
/* Button */
.button {
  background: transparent;
  border: 2px solid #FFFFFF;
  color: #FFFFFF;
  padding: 12px 24px;
  font-family: 'JetBrains Mono';
  border-radius: 0; /* No rounded corners */
  transition: all 0.2s;
}

.button:hover {
  background: #FFFFFF;
  color: #000000;
  border-color: #FF0000;
}

/* Habit Card */
.habit-card {
  background: #111111;
  border: 1px solid #333333;
  padding: 20px;
  margin: 16px 0;
  border-radius: 0;
}

/* Chat Message */
.message-ai {
  background: #1a1a1a;
  color: #FFFFFF;
  font-family: 'Courier New';
  padding: 12px;
  margin: 8px 0;
  border-left: 3px solid #FF0000;
}

.message-user {
  background: #0a0a0a;
  color: #FFFFFF;
  padding: 12px;
  margin: 8px 0;
  border-right: 3px solid #999999;
  text-align: right;
}
```

---

## 🔧 **UPDATED CONVEX SCHEMA (Complete)**

```typescript
// convex/schema.ts

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    aiPersonality: v.literal("brutal"),
    subscriptionTier: v.union(v.literal("free"), v.literal("pro")),
    onboardingCompleted: v.boolean(),
    dailyMessageCount: v.number(), // Reset at midnight
    lastMessageReset: v.number(), // Timestamp
  }).index("by_clerk_id", ["clerkId"]),

  // Habits
  habits: defineTable({
    userId: v.id("users"),
    name: v.string(),
    targetDays: v.array(v.string()), // ["mon", "wed", "fri", "sat"]
    scheduledTime: v.string(), // "17:00" (default for all days)
    reminderTime: v.string(), // "16:00"
    checkInDeadline: v.string(), // "18:30"
    schedules: v.optional(v.object({
      // Override for specific days
      fri: v.optional(v.object({
        scheduledTime: v.string(),
        reminderTime: v.string(),
        checkInDeadline: v.string(),
      })),
    })),
    rules: v.string(), // "Any workout 30+ mins"
    motivation: v.string(), // User's why
    currentStreak: v.number(),
    bestStreak: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Check-ins
  checkIns: defineTable({
    habitId: v.id("habits"),
    userId: v.id("users"),
    date: v.string(), // "2025-01-15"
    status: v.union(
      v.literal("completed"),
      v.literal("missed"),
      v.literal("bonus")
    ),
    source: v.union(
      v.literal("dashboard_quick"),
      v.literal("chat"),
      v.literal("auto_deadline")
    ),
    userReason: v.optional(v.string()), // For missed days
    conversationSummary: v.optional(v.string()),
    aiResponse: v.string(),
    timestamp: v.number(),
  })
    .index("by_habit", ["habitId"])
    .index("by_user_date", ["userId", "date"]),

  // Workout logs (detailed)
  workoutLogs: defineTable({
    habitId: v.id("habits"),
    checkInId: v.id("checkIns"),
    exercises: v.array(
      v.object({
        name: v.string(),
        sets: v.optional(v.number()),
        reps: v.optional(v.number()),
        weight: v.optional(v.number()),
        duration: v.optional(v.number()), // minutes
        distance: v.optional(v.number()), // km
      })
    ),
    notes: v.optional(v.string()),
  }).index("by_habit", ["habitId"]),

  // Chat messages
  messages: defineTable({
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")), // null for general chat
    role: v.union(v.literal("user"), v.literal("ai")),
    content: v.string(),
    intent: v.optional(v.string()), // "check_in", "question", "excuse"
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_habit", ["habitId"]),

  // Scheduled reminders
  reminders: defineTable({
    habitId: v.id("habits"),
    userId: v.id("users"),
    scheduledFor: v.number(), // Unix timestamp
    type: v.union(
      v.literal("pre_workout"),
      v.literal("check_in"),
      v.literal("late_follow_up")
    ),
    sent: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_scheduled", ["scheduledFor", "sent"]),

  // Weekly reports
  weeklyReports: defineTable({
    userId: v.id("users"),
    habitId: v.id("habits"),
    weekStart: v.string(),
    weekEnd: v.string(),
    targetCount: v.number(),
    actualCount: v.number(),
    bonusCount: v.number(),
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

## 🤖 **AI SYSTEM ARCHITECTURE**

### **AI Functions (Convex Actions with Claude API)**

```typescript
// convex/ai.ts

import { action } from "./_generated/server";
import { v } from "convex/values";

export const generateAIResponse = action({
  args: {
    userMessage: v.string(),
    habitId: v.id("habits"),
    conversationHistory: v.array(v.object({
      role: v.string(),
      content: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    // Fetch habit data
    const habit = await ctx.runQuery(api.habits.get, {
      id: args.habitId
    });
    
    // Fetch recent check-ins
    const recentCheckIns = await ctx.runQuery(api.checkIns.getRecent, {
      habitId: args.habitId,
      limit: 7
    });

    // Build AI prompt
    const prompt = `You are a brutal but helpful gym coach.

User's habit: ${habit.name}
Motivation: ${habit.motivation}
Current streak: ${habit.currentStreak} days

Recent pattern (last 7 days):
${recentCheckIns.map(c => `${c.date}: ${c.status}`).join("\n")}

Conversation history:
${args.conversationHistory.map(m => `${m.role}: ${m.content}`).join("\n")}

User's message: "${args.userMessage}"

Rules:
1. Keep response under 60 words
2. Be brutally honest but not mean
3. Reference their motivation when they miss
4. Call out patterns
5. Use casual language (bro, nah, aight)

Respond as the coach:`;

    // Call Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    const data = await response.json();
    return data.content[0].text;
  },
});

export const extractWorkoutData = action({
  args: {
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const prompt = `Extract workout data from this message.
Return ONLY valid JSON, no other text.

Message: "${args.message}"

JSON format:
{
  "exercises": [
    {
      "name": "exercise name",
      "sets": number or null,
      "reps": number or null,
      "weight": number or null,
      "duration": number or null
    }
  ],
  "notes": "any additional notes or null"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    const data = await response.json();
    const jsonText = data.content[0].text.replace(/```json|```/g, "").trim();
    return JSON.parse(jsonText);
  },
});
```

---

## 📋 **FINAL BUILD PROTOCOL - PRE-FLIGHT CHECKLIST**

```
APP NAME: Streak

ONE-SENTENCE PITCH: A brutalist habit tracker with an AI coach that roasts you into consistency through conversational check-ins and proactive reminders

UI AESTHETIC: Pure black (#000000), white text, red streak accents, monospace headings (JetBrains Mono), no rounded corners, Vercel/Linear minimalism, brutalist hard edges

DEPLOYMENT TARGET: Vercel

CORE BUSINESS ENTITIES:

1. USER PROFILE
   - Syncs with Clerk authentication
   - Tracks: Polar.sh subscription tier (Free/Pro), AI personality, onboarding status, daily message count
   
2. HABITS
   - Belongs to: User (via userId)
   - Fields: name, targetDays (array), scheduledTime, reminderTime, checkInDeadline, schedules (day-specific overrides), rules, motivation, currentStreak, bestStreak, isActive, createdAt
   - Constraints: Max 3 habits for free tier, unlimited for pro
   
3. CHECK-INS
   - Belongs to: Habit + User
   - Fields: date, status (completed/missed/bonus), source (dashboard_quick/chat/auto_deadline), userReason, conversationSummary, aiResponse, timestamp
   - Used for: Daily tracking, AI response generation
   
4. WORKOUT LOGS
   - Belongs to: Habit + CheckIn
   - Fields: exercises (array with sets/reps/weight/duration), notes
   - Extracted from: Natural language chat conversations via AI
   
5. MESSAGES (Chat History)
   - Belongs to: User + optional Habit
   - Fields: role (user/ai), content, intent, timestamp
   - Used for: Conversational interface, AI context building
   
6. REMINDERS (Scheduled)
   - Belongs to: Habit + User
   - Fields: scheduledFor (timestamp), type (pre_workout/check_in/late_follow_up), sent (boolean)
   - Used for: Push notifications via Convex cron jobs
   
7. WEEKLY REPORTS
   - Belongs to: User + Habit
   - Fields: weekStart, weekEnd, targetCount, actualCount, bonusCount, completionRate, aiRoast, missedDaysReasons
   - Generated: Every Sunday at 9pm

SPECIAL FEATURES/REQUIREMENTS:
- Real-time streak updates (Convex subscriptions)
- Proactive AI reminders throughout day (4pm pre-workout, 6pm check-in, 6:35pm late follow-up)
- Push notifications via Convex scheduled functions
- Natural language workout extraction (Claude API in Convex actions)
- Chat interface as primary interaction method
- Dashboard for quick visual check-ins (alternative to chat)
- AI personality: Brutal coach mode with context awareness
- Message limits: 20/day free tier, unlimited pro tier
- Export data to CSV (Pro feature)
- Dark mode only (pure black brutalist aesthetic)
- Day-specific schedule overrides (e.g., Friday morning vs weekday evening)
```

---

**END OF COMPLETE USER FLOW** 🔥

This is the **FINAL**, production-ready flow. Every screen, every interaction, every AI behavior is documented. Ready untuk build protocol execution?