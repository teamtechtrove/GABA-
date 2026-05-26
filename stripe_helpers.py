import os
import stripe

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")

STRIPE_PRO_PRICE_ID     = os.environ.get("STRIPE_PRO_PRICE_ID", "")
STRIPE_WEBHOOK_SECRET   = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

PLAN_PRICES = {
    "pro": STRIPE_PRO_PRICE_ID,
}

def create_checkout_session(user_id: str, user_email: str, plan: str, success_url: str, cancel_url: str):
    price_id = PLAN_PRICES.get(plan)
    if not price_id:
        raise ValueError(f"Unknown plan or missing price ID for plan: {plan}")

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        client_reference_id=user_id,
        customer_email=user_email,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": user_id, "plan": plan},
    )
    return session

def construct_webhook_event(payload: bytes, sig_header: str):
    return stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
