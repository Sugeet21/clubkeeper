# Business Context

## Product Identity

**ClubKeeper** is a digital replacement for the paper notebook used at indoor game clubs (pool halls, snooker clubs, carrom clubs, PlayStation gaming zones) in India.

**Tagline (working):** "The notebook is killing your business. Stop losing ₹10,000/month."

## Target Customer

**Primary:** Small Indian indoor game club owners.
- Location: Tier 1, 2, 3 cities in India (starting with Pune for Sugeet)
- Size: 1-2 staff, 3-10 tables
- Revenue: ₹50,000 – ₹5,00,000 per month
- Tech literacy: Owner has a smartphone. Maybe a basic Windows PC. NOT comfortable with complex software.
- Current workflow: Paper notebook on a counter, ballpoint pen, occasional calculator
- Pain points: forgotten timers, customer disputes ("I only played 30 min!"), no day-end visibility, staff theft via "forgotten" entries

**Buying decision maker:** Owner. Always. Staff don't buy SaaS.

**NOT the target (for v1):**
- Large gaming chains (they have ERP)
- Casual/home users
- Restaurants/cafes that happen to have a pool table
- Non-Indian markets (currency, payment, language assumptions don't fit)

## Pricing Strategy

Subscription model. Recurring monthly billing in INR via Razorpay NACH auto-debit (or Cashfree).

### Tier Structure (Working Plan)

| Tier | Price | Tables | Use Case |
|---|---|---|---|
| Starter | ₹299/month | Up to 3 | Solo owner, small setup |
| Standard | ₹599/month | Up to 8 | Most clubs |
| Pro | ₹999/month | Unlimited | Large clubs, multi-staff (when added) |
| Annual | 2 months free | — | Lock-in discount on any tier |

**Sweet spot:** Standard at ₹599. Aim for 80% of customers here.

### The ROI Math (sales pitch foundation)

Average pain math for the prospect:
- Staff forgets to start/stop timer 3 times/day average
- Average session: 1 hour × ₹120 = ₹120 lost per forget
- 3 × ₹120 = ₹360/day = ₹10,800/month lost

At ₹599/month, ROI = 18×. Payback period = under 2 days.

**Always lead with the ROI math.** Not with features.

### Discounts to Offer

- First 10 customers: 3 months free for testimonial + referrals (Beta)
- Annual upfront: 2 months free (₹5,990 vs ₹7,188 monthly)
- Multi-location (future): 20% off second location

### What NOT to discount

- Below ₹299/month. Cheap customers churn fast and complain most.
- Per-table pricing below 3 tables. Too thin margin.

## Sales Channels

### Phase 1: Founder-led (Months 0-6)

This is where Sugeet is now. Direct sales by Sugeet visiting clubs.

1. **Visit clubs in Pune.** Show app on his phone. Free 1-month trial.
2. **Existing 2-3 clubs he's visited** = warm intros. Start there.
3. **Google Maps prospecting:** Search "billiards club Pune", "pool hall Pune", "carrom club Pune". Call, visit, demo.
4. **WhatsApp pitch** as follow-up after in-person visit.
5. **Referrals from happy customers.** Offer 1 month free for each successful referral.

### Phase 2: Local content (Months 3-12)

- **YouTube Shorts / Instagram Reels:** 60-sec demos showing app in real club setting
- **Local Facebook groups** for small business owners in Pune
- **WhatsApp Business broadcast lists** of club owner contacts
- **Local language content:** Marathi + Hindi posts perform better

### Phase 3: Scale (Year 2+)

- Partner with billiards equipment dealers — they sell, you give them 1 month commission
- Trade publication ads in cue sports magazines
- Trade show booths at sports retail events

## Sales Pitch (Practice This)

**Hook:** "How much do you lose per day when your boys forget to start the timer?"

(Owner thinks. Says "maybe ₹200-300.")

"That's ₹6,000-9,000 per month. Gone. My app times every table automatically. ₹599/month. Pays for itself in 2 days. Want to try free for a month?"

**Objection handling:**
- "I don't have time to learn new app" → "Install karke 5 minute me ready ho jata hai. Aaj abhi dikhata hu." Demo on the spot.
- "My boys don't know phones" → "Owner login hai aapka. Aap se chalega. Staff ko sirf 'start' aur 'stop' button dabana hai."
- "I don't trust online apps" → "Sab data aapke phone me hai. Internet bina bhi chalta hai. Aap dikhao bhi ki phone diya nahi kisi ko."
- "Notebook works fine for me" → "Kitna paisa kal kamaya, abhi 5 second me bata sakte ho? Ya pura notebook check karna padega?"

## Cost Structure

### Monthly costs (at 50 customers, ₹500 avg revenue)

| Item | Cost |
|---|---|
| Vercel hosting (Pro tier when needed) | ₹0–1,600 |
| Domain | ₹70 |
| Razorpay fees (2% of ₹25,000) | ₹500 |
| MSG91 SMS OTP (~5,000 OTPs) | ₹750 |
| Database (Supabase free → Pro when 100+ customers) | ₹0–2,100 |
| Email (SendGrid/Resend free tier) | ₹0 |
| **Total** | **~₹2,000–5,000/month** |

Revenue at 50 customers: ₹25,000/month
**Net margin: ~₹20,000-23,000/month profit.** Mostly passive once built.

### One-time costs

- Custom domain (clubkeeper.in): ~₹800/year
- Privacy policy + terms template: ₹2,000–5,000 (use TermsFeed or similar)
- Business registration if formalizing: ₹2,500-15,000 (consult CA)

## Competitor Landscape

### Direct competitors (Indian indoor games SaaS)

Very few. The space is largely undigitized.

- Some generic POS apps (Petpooja, Posist) try to serve this market but are restaurant-focused and overkill.
- Some local solutions exist but are usually one-off custom builds.

### Indirect competitors (alternatives the owner uses today)

1. **Paper notebook + calculator** — 90% of clubs. This is Sugeet's real competitor.
2. **Excel on owner's laptop** — 5% of clubs, used by tech-savvier owners.
3. **WhatsApp messages** — owner texts himself session details.

### Competitive moat (for ClubKeeper)

- **First-mover in India** for this niche
- **Offline-first** — works without internet (most apps don't)
- **Hindi/Marathi UI later** — most SaaS is English-only
- **WhatsApp bill sharing** (planned v2) — culturally fits
- **Local sales relationship** with Pune clubs first → social proof

## Growth Targets (Realistic)

| Month | Customers | MRR |
|---|---|---|
| 1-2 | 0 (building) | ₹0 |
| 3 | 1-3 paying | ₹500-1,500 |
| 6 | 15-25 | ₹7,500-12,500 |
| 12 | 50-80 | ₹25,000-40,000 |
| 24 | 150-250 | ₹75,000-1,25,000 |

At 100 customers paying ₹500 avg, ~₹6L/year recurring. Mostly passive after first 6 months of intense sales.

## What Will Justify Higher Prices (v2 Features)

These features each let the Pro tier feel justified at ₹999+:

1. **WhatsApp bill sharing** — owner sends customer a bill on WhatsApp with one tap. HUGE in India.
2. **UPI payment collection within bill** — customer scans QR, pays, marked as collected. Take 0.5-1% transaction fee.
3. **Staff login with PIN** — multi-staff clubs will pay extra for this.
4. **Monthly P&L report** — for accountant. Makes the app sticky.
5. **Multi-location** — owner with 2 clubs pays for both as separate plans, or one bundled plan at 1.5× single.
6. **Customer loyalty tracking** — see top 20 customers, their spend, last visit. For VIP retention.
7. **Snacks/drinks add-ons** — clubs often sell tea, cigarettes alongside games. Charge per item.

## Phase 2 Revenue Streams (Beyond Subscription)

- **Payment processing fee:** 0.5-1% of transaction value when ClubKeeper handles collection
- **Premium templates / themes:** Light theme, custom branding (₹199-499 one-time)
- **Annual setup fee:** ₹999 one-time for white-glove setup at the club (sales-led)
- **Integration partnerships:** Local POS/billing services pay for integration (B2B)

## Decision Triggers

- **Hire sales help when:** Sugeet personally can't visit more clubs (~20 customers, depends on geography)
- **Hire developer help when:** Sugeet has 50+ customers AND clear feature backlog AND money to pay ₹40k+/month
- **Raise outside money when:** ONLY if there's a defensible reason to grow faster than profit allows. Bootstrapping is fine and probably better for this market.

## Brand Voice

- **Friendly, direct, founder-speaking-to-founder.** Not corporate.
- **Hinglish where natural** — don't force pure English in WhatsApp/local marketing
- **Numbers over adjectives.** "Save ₹10,000/month" beats "increase efficiency"
- **Owner-centric.** Talk about the owner's pain, not the staff's convenience
- **Concrete, not abstract.** "5 second me revenue dikhayega" beats "real-time analytics dashboard"

## Long-term Vision

If ClubKeeper hits 500+ customers:
- Extend to **Snooker leagues / amateur tournament management**
- Build **customer-facing app** so players see live wait times and book tables
- Expand from indoor games to **table tennis clubs, badminton courts** (similar timer-based usage)
- Eventually a **gaming venue OS** — bookings + sessions + bills + memberships

But focus on the current niche first. Don't dilute.
