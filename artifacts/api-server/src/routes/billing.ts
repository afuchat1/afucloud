import { Router, type IRouter, type NextFunction, type Response } from "express";
import {
  CreateBillingCheckoutBody,
  CreateBillingCheckoutResponse,
  GetBillingSummaryResponse,
  SyncBillingSubscriptionResponse,
} from "@workspace/api-zod";
import { BillingError, createSubscriptionCheckout, getBillingSummary } from "../lib/billing";
import { requireAccountAuth, requireAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use("/v1/billing", requireAuth, requireAccountAuth);

function handleBillingError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof BillingError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

router.get("/v1/billing", async (req, res, next): Promise<void> => {
  try {
    const summary = await getBillingSummary((req as AuthRequest).userId!);
    res.json(GetBillingSummaryResponse.parse(summary));
  } catch (error) {
    handleBillingError(error, res, next);
  }
});

router.post("/v1/billing/sync", async (req, res, next): Promise<void> => {
  try {
    const summary = await getBillingSummary((req as AuthRequest).userId!);
    res.json(SyncBillingSubscriptionResponse.parse(summary));
  } catch (error) {
    handleBillingError(error, res, next);
  }
});

router.post("/v1/billing/checkout", async (req, res, next): Promise<void> => {
  const parsed = CreateBillingCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const checkout = await createSubscriptionCheckout(
      (req as AuthRequest).userId!,
      parsed.data.planKey,
    );
    res.status(201).json(CreateBillingCheckoutResponse.parse(checkout));
  } catch (error) {
    handleBillingError(error, res, next);
  }
});

export default router;
