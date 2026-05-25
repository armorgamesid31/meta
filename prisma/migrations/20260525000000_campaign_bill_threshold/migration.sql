-- Add BILL_THRESHOLD to the CampaignType enum. New campaigns of this
-- type reward a customer when the computed bill for a single booking
-- exceeds `config.thresholdAmount`, applying an extra discount or a
-- free service on top of other auto-stacks.

ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'BILL_THRESHOLD';
