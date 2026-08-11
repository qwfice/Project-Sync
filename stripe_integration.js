// ============================================================
// ProjectSync Stripe Integration — Pro Tier Payments
// ============================================================
// This adds a "Upgrade to Pro" button that opens Stripe Checkout
// 
// SETUP:
// 1. Create Stripe account: https://stripe.com
// 2. Go to Stripe Dashboard > Products > Create Product
//    Name: "ProjectSync Pro"
//    Price: $3.00 / month (or $24.00 / year)
// 3. Copy the Price ID (looks like: price_1ABC...)
// 4. Paste it below in STRIPE_PRICE_ID
// 5. Also get your Publishable Key from Dashboard > Developers > API Keys
//
// For testing, use test mode keys. Switch to live keys when ready.
// ============================================================

const STRIPE_PUBLISHABLE_KEY = 'pk_test_YOUR_PUBLISHABLE_KEY_HERE';
const STRIPE_PRICE_ID = 'price_YOUR_PRICE_ID_HERE';  // Monthly Pro plan
const STRIPE_PRICE_ID_YEARLY = 'price_YOUR_YEARLY_PRICE_ID_HERE';  // Optional: yearly plan

// Load Stripe.js dynamically
function loadStripeScript() {
  return new Promise((resolve, reject) => {
    if (window.Stripe) {
      resolve(window.Stripe);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve(window.Stripe);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

const stripePayments = {
  stripe: null,

  async init() {
    try {
      await loadStripeScript();
      this.stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
      console.log('Stripe loaded successfully');
    } catch (err) {
      console.error('Failed to load Stripe:', err);
    }
  },

  // ============================================================
  // CHECKOUT — Redirect to Stripe Hosted Checkout
  // ============================================================
  async checkoutPro(isYearly = false) {
    if (!this.stripe) {
      await this.init();
    }

    if (!app.user) {
      app.showToast('Please sign in first', 'error');
      return;
    }

    const priceId = isYearly ? STRIPE_PRICE_ID_YEARLY : STRIPE_PRICE_ID;

    // Create checkout session via Supabase Edge Function
    // (You need to deploy this edge function — see supabase/functions/create-checkout/index.ts)
    try {
      const { data, error } = await supabaseClient.functions.invoke('create-checkout', {
        body: {
          price_id: priceId,
          user_id: app.user.id,
          email: app.user.email,
          success_url: window.location.origin + '/app?payment=success',
          cancel_url: window.location.origin + '/app?payment=cancel'
        }
      });

      if (error) throw error;

      // Redirect to Stripe Checkout
      window.location.href = data.url;

    } catch (err) {
      console.error('Checkout error:', err);
      // Fallback: Use Stripe Payment Links (no-code option)
      this.openPaymentLink(isYearly);
    }
  },

  // ============================================================
  // FALLBACK: Stripe Payment Links (No-Code, No Backend Needed!)
  // ============================================================
  // This is the EASIEST way to accept payments. Just create a 
  // Payment Link in Stripe Dashboard and paste the URL here.

  PAYMENT_LINK_MONTHLY: 'https://buy.stripe.com/test_YOUR_MONTHLY_LINK',
  PAYMENT_LINK_YEARLY: 'https://buy.stripe.com/test_YOUR_YEARLY_LINK',

  openPaymentLink(isYearly = false) {
    const link = isYearly ? this.PAYMENT_LINK_YEARLY : this.PAYMENT_LINK_MONTHLY;
    // Add user email as prefilled data
    const url = new URL(link);
    if (app.user?.email) {
      url.searchParams.set('prefilled_email', app.user.email);
    }
    window.open(url.toString(), '_blank');
  },

  // ============================================================
  // CHECK SUBSCRIPTION STATUS
  // ============================================================
  async checkSubscriptionStatus() {
    if (!app.user) return false;

    try {
      const { data, error } = await supabaseClient
        .from('subscriptions')
        .select('*')
        .eq('user_id', app.user.id)
        .eq('status', 'active')
        .single();

      if (error || !data) return false;

      // Check if subscription is still valid
      const now = new Date();
      const endDate = new Date(data.current_period_end);
      return endDate > now;

    } catch (err) {
      return false;
    }
  },

  // ============================================================
  // UI: Show Upgrade Modal
  // ============================================================
  showUpgradeModal() {
    const modal = document.createElement('div');
    modal.id = 'upgradeModal';
    modal.className = 'fixed inset-0 z-[70] flex items-center justify-center';
    modal.innerHTML = `
      <div class="modal-overlay absolute inset-0" onclick="stripePayments.hideUpgradeModal()"></div>
      <div class="relative bg-white rounded-3xl p-6 max-w-sm w-full mx-4 card-shadow slide-up">
        <div class="text-center mb-6">
          <div class="w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-crown text-white text-2xl"></i>
          </div>
          <h2 class="text-2xl font-bold text-slate-800 mb-1">ProjectSync Pro</h2>
          <p class="text-slate-400 text-sm">Unlock your full potential</p>
        </div>

        <div class="space-y-3 mb-6">
          <div class="flex items-center gap-3 text-sm">
            <i class="fas fa-check-circle text-success-500"></i>
            <span class="text-slate-700">Unlimited projects</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <i class="fas fa-check-circle text-success-500"></i>
            <span class="text-slate-700">Advanced analytics</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <i class="fas fa-check-circle text-success-500"></i>
            <span class="text-slate-700">Priority support</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <i class="fas fa-check-circle text-success-500"></i>
            <span class="text-slate-700">Export to PDF/Excel</span>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <i class="fas fa-check-circle text-success-500"></i>
            <span class="text-slate-700">Custom themes</span>
          </div>
        </div>

        <div class="space-y-3">
          <div class="bg-slate-50 rounded-xl p-4 border-2 border-primary-500">
            <div class="flex items-center justify-between mb-2">
              <span class="font-bold text-slate-800">Monthly</span>
              <span class="text-2xl font-bold text-primary-600">$3<span class="text-sm text-slate-400 font-normal">/mo</span></span>
            </div>
            <p class="text-xs text-slate-400">Billed monthly. Cancel anytime.</p>
            <button onclick="stripePayments.checkoutPro(false)" class="w-full mt-3 bg-primary-600 text-white font-semibold py-3 rounded-xl btn-press">
              Upgrade Monthly
            </button>
          </div>

          <div class="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <div class="flex items-center justify-between mb-2">
              <span class="font-bold text-slate-800">Yearly</span>
              <div>
                <span class="text-xs bg-success-100 text-success-600 px-2 py-0.5 rounded font-medium">Save 33%</span>
                <span class="text-2xl font-bold text-primary-600 ml-2">$24<span class="text-sm text-slate-400 font-normal">/yr</span></span>
              </div>
            </div>
            <p class="text-xs text-slate-400">Billed annually. Best value for students.</p>
            <button onclick="stripePayments.checkoutPro(true)" class="w-full mt-3 bg-white border-2 border-primary-600 text-primary-600 font-semibold py-3 rounded-xl btn-press">
              Upgrade Yearly
            </button>
          </div>
        </div>

        <button onclick="stripePayments.hideUpgradeModal()" class="w-full mt-4 text-slate-400 text-sm font-medium py-2 btn-press">
          Maybe later
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  },

  hideUpgradeModal() {
    const modal = document.getElementById('upgradeModal');
    if (modal) modal.remove();
  },

  // ============================================================
  // CHECK PAYMENT RETURN (after Stripe redirect)
  // ============================================================
  async checkPaymentReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');

    if (paymentStatus === 'success') {
      app.showToast('🎉 Welcome to ProjectSync Pro!', 'success');
      // Refresh user profile to update subscription status
      await app.loadUserProfile();
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'cancel') {
      app.showToast('Payment cancelled. No worries!', 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
};

// Auto-check payment return on page load
document.addEventListener('DOMContentLoaded', () => {
  stripePayments.checkPaymentReturn();
});
