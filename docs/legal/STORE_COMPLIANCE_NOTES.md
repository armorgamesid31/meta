# Store Compliance Notes

Last updated: 2026-04-07

This note summarizes the current store-review posture for the mobile app based on the repository review performed on 2026-04-07.

## 1. Current product posture

- App name in mobile config: `Kedy Salon Management`
- Mobile repo: `Salonmanagementsaasapp`
- Backend repo: `meta`
- First public mobile release assumption: login only, with pre-provisioned staff accounts
- Planned active features at launch: push notifications, Instagram and WhatsApp operations, imports and OCR, analytics, CRM, scheduling, campaigns, and related admin tooling

## 2. Is the "processor / service provider" framing acceptable?

Yes, but only if it is described carefully.

The reviewed architecture supports saying:

- Kedy is generally a processor or service provider for salon customer records, appointment records, CRM data, conversation data, and imported operational data processed on behalf of each salon.
- Kedy is not only a processor. Kedy is also likely an independent controller for business account data, security logs, session data, push registration data, support records, and legal compliance records tied to use of the Kedy service itself.

This mixed-role structure is normal for B2B SaaS and should be acceptable if the privacy policy, customer terms, and any DPA use the same framing consistently.

## 3. Store policy impact

### Apple App Store

- A privacy policy link is required in App Store Connect metadata and within the app.
- Because the current first-release assumption is login only, with no account creation flow in the app, Apple account-deletion-in-app requirements are less likely to be triggered for launch.
- If the app later supports account creation, Apple expects account deletion within the app.
- Because the app is login-gated, Apple review should be given a working demo account and any necessary review notes.

### Google Play

- A privacy policy is required even if an app declares no user data collection.
- Data Safety declarations must match real app behavior, including third-party SDKs and integrations.
- Google's app-account deletion requirement is triggered if the app allows account creation in the app or sends the user to an account-creation flow outside the app.
- Under the current launch assumption of login only with no sign-up path in the app experience, the stricter account-creation deletion rule is less likely to apply at launch.
- Even so, shipping a public data-deletion web page is still recommended now, not later.
- Google review should also be provided with an active review account when access is login-gated.

## 4. Data categories observed from code review

The current app and backend appear to process these categories:

- Name
- Email address
- User ID / account ID
- Phone number
- Address
- Other personal info such as gender and date of birth
- Customer records and appointment history
- Payment method labels and purchase-like operational history
- Message content and conversation history from Instagram and WhatsApp workflows
- Uploaded files and documents
- Uploaded images and PDFs used for imports and OCR
- Push token and device metadata

The current reviewed mobile build did not show evidence of:

- location permission use
- contacts permission use
- camera permission use
- microphone permission use
- advertising SDKs
- cross-app tracking
- crash analytics SDKs

## 5. Third-party processors or integrations visible in code

The reviewed repositories show integrations or references for:

- Firebase Cloud Messaging
- Meta / Instagram / WhatsApp
- Chakra messaging integration
- cloud object storage for imports
- OCR workflow using external webhook and Google Vision-oriented automation

These integrations should be reflected in the privacy policy as service providers, processors, or integration partners, as applicable.

## 6. Recommended retention posture for launch

The business has not finalized retention rules yet, so the launch policy should use a practical and defensible baseline:

- Import source files: about 30 days
- Sessions and tokens: until expiry, revocation, logout, or short security retention
- Push tokens: until replacement, unregister, inactivity, or account removal
- Customer and appointment records: according to salon instructions and legal requirements
- Backups and logs: limited additional retention for security and recovery

If you adopt a stricter or longer retention period later, update the public policy and any store declarations.

## 7. Suggested store declaration posture

### Apple privacy label

Likely relevant data types:

- Contact Info: Name, Email Address, Phone Number, Physical Address
- Identifiers: User ID, Device ID
- User Content: Emails or Text Messages, Photos or Videos, Other User Content
- Purchases: Purchase History
- Other Data: other operational records where needed

Likely purpose tags:

- App Functionality
- Product Personalization where salon-specific experience is tailored
- Analytics only if you later add actual app-usage analytics collection

Tracking:

- Based on the reviewed code, do not describe the current build as using tracking for third-party advertising.

### Google Play Data Safety

Likely relevant data types:

- Personal info: name, email address, user IDs, address, phone number, other info
- Messages: other in-app messages
- Photos and videos: photos
- Files and docs: files and docs
- App info and performance: device or other IDs
- Financial info: purchase history, if you choose to declare appointment and package purchase records in scope

Purposes likely applicable:

- app functionality
- account management
- developer communications for notifications
- fraud prevention, security, and compliance

Sharing:

- Transfers to true service providers acting on your behalf may not need to be declared as "sharing" in Google Play Data Safety, but the underlying collection still needs to be declared accurately.

## 8. Launch checklist

- Add the privacy policy URL to App Store Connect and Play Console
- Add a visible privacy-policy link inside the mobile app
- Publish the account-and-data-deletion page on a public URL
- Prepare demo credentials for Apple and Google reviewers
- Keep sign-up and register flows out of the mobile app and store metadata for the first launch if you want to avoid triggering account-creation deletion requirements immediately
- Revisit store declarations the moment you add sign-up, invite acceptance, or account creation anywhere in the in-app experience
