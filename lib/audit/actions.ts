// The catalogue of platform audit actions (docs/TENANCY-S5.md, C7).
//
// Every audit event names one of these, so a reader of the log can rely on the
// vocabulary: `<area>.<thing>.<verb>`, dotted lower-case, which is the shape the
// action CHECK on platform_audit_events accepts. auditMutation and withAudit
// (lib/audit/route.ts) take only these; the IDOR suite fails on any other name.
//
// A PR that audits a new route appends its actions here in the same PR, under
// its area. Keep an action once it has been written: rows are never erased, so
// a renamed action would split the history.

export const AUDIT_ACTIONS = [
  // Support: view-as (app/api/admin/impersonation)
  'support.impersonate.start',
  'support.impersonate.stop',
  // Support: S6 support sessions (app/api/admin/support/session), on the TENANT's chain
  'support.session.open',
  'support.session.close',
  // S6-BG break-glass: the request, the tenant admin's answer, opening and renewing
  // (app/api/admin/support/consent, app/api/support-consents/[id], app/api/admin/support/break-glass)
  'support.consent.request',
  'support.consent.approve',
  'support.consent.decline',
  'support.break_glass.open',
  'support.break_glass.renew',
  // S6-SUP-UI: the changes break-glass can make (app/api/admin/platform/support/*), on the
  // session tenant's chain with support_session in the metadata
  'support.company.rename',
  // S6-CON: the super-admin console suspends and resumes a tenant
  // (app/api/admin/platform/tenants/[id]/status), on the TENANT's chain
  'platform.tenant.suspend',
  'platform.tenant.resume',
  // S6-CON-b: a per-tenant switch set from the console (app/api/admin/platform/tenants/[id]/flags)
  'platform.tenant_flag.set',

  // Crons (B12) and webhooks (A13)
  'cron.run.finish',
  'webhook.event.process',

  // Registration (A7, A8)
  'registration.individual.create',
  'registration.group.create',
  'registration.group_join.create',
  'registration.payment.start',
  'registration.seat_payment.start',
  'registration.participant.create',
  'registration.participant.update',
  // An organiser's team writes (A8): app/api/members/teams/**
  'registration.participant.remove',
  'registration.roster.sheet_sync',
  'registration.seat_payment_link.create',
  'registration.payment_method.change',
  'registration.invoice_discount.change',
  // Event add-ons booked from the member side, and an add-on pay link opened (lib/addons)
  'registration.addon.book',
  'registration.addon.cancel',
  'registration.addon_payment.start',
  // Guardian consent on a tenant's event (S5 wave 6, lib/registration/tenant-guardian-consent.ts)
  'registration.guardian_consent.request',
  'registration.guardian_consent.sign',
  'registration.guardian_consent.decline',
  'registration.guardian_consent.expire',
  // A date-of-birth correction lifted a pending consent; its open envelope was voided.
  'registration.guardian_consent.lift',
  // A consent envelope from an earlier registration was voided.
  'registration.guardian_consent.void',
  // Staff resent a pending consent's invitation, or chased the guardian (wave 8 CONSENT (c)).
  'registration.guardian_consent.resend',

  // Consent and uploads (A14)
  'consent.request.send',
  'consent.request.settle',
  'upload.sign.create',

  // Public and store writes (B18)
  'email.unsubscribe.apply',
  'store.order.fulfilment_update',
  'campaign.submission.create',
  'scholarship.application.create',
  'store.checkout.create',
  'store.order.reship',
  'store.order.stale_reship_cancel',
  'privacy.request.create',
  'privacy.request.confirm',
  'teacher_grant.application.create',

  // Event Manager role (app/api/admin/members/[id]/event-manager)
  'role.event_manager.assign',
  'role.event_manager.update',
  'role.event_manager.remove',

  // Staff role (app/api/admin/members/[id]/staff)
  'role.staff.grant',
  'role.staff.revoke',
  'role.staff.recheck',

  // Background checks a member already holds (…/external-check)
  'compliance.external_check.submit',
  'compliance.external_check.verify',
  'compliance.external_check.remove',
  // A member's own account (B16): app/api/members, except teams (A8)
  'member.address.create',
  'member.address.update',
  'member.address.delete',
  'member.payment_link.create',
  'member.compliance_document.create',
  'member.compliance_document.delete',
  'member.compliance_license.update',
  'member.deletion_request.create',
  'member.directory_prefs.update',
  'member.agreement.download',
  'member.event_participation.create',
  'member.event_participation.delete',
  'member.profile.update',
  'member.onboarding.submit',
  'member.privacy_prefs.update',
  'member.registration.withdraw_preview',
  'member.registration.withdraw',
  'member.survey.open',
  'member.survey.save',
  'member.survey.submit',
  'member.survey_quote.withdraw',

  // Community (B16): app/api/community
  'community.chat_message.create',
  'community.chat_message.delete',
  'community.chat_message.flag',
  'community.coaching.manage',
  'community.coaching_session.request',
  'community.coaching_request.create',
  'community.coaching_request.book',
  'community.coaching.topup',
  'community.cohort_invite.respond',
  'community.comment.create',
  'community.content.flag',
  'community.host_availability.create',
  'community.host_availability.delete',
  'community.host_session.manage',
  'community.media.publish',
  'community.mentoring_cohort.create',
  'community.mentoring.manage',
  'community.mentoring.register',
  'community.mentoring.topup',
  'community.notifications.mark_read',
  'community.post.create',
  'community.post.update',
  'community.reaction.toggle',
  'community.resource.attach',
  'community.resource.download',
  'community.resource_attachment.rename',
  'community.resource.contribute',
  'community.session_action.toggle',
  'community.space_invite.respond',
  'community.space.join',
  'community.training_item.flag',
  'community.training.group_nudge',
  'community.training.progress',

  // Stellr-only community, academy, training and entitlements admin (C13)
  'coaching.request.decline',
  'coaching.request.match',
  'coaching.workshop.ensure',
  'community.cohort.manage',
  'community.flag.resolve',
  'community.gate.delete',
  'community.gate.set',
  'community.resource.create',
  'community.resource.delete',
  'community.resource.update',
  'community.space.configure',
  'community.space.create',
  'community.space.delete',
  'community.space.update',
  'community.space_resource.add',
  'community.workshop.manage',
  'container.content.add',
  'container.content.remove',
  'entitlement.allocation.update',
  'entitlement.discount.delete',
  'entitlement.discount.save',
  'membership.rule.create',
  'membership.rule.delete',
  'membership.rule.update',
  'training.assignment.delete',
  'training.assignment.save',
  'training.assignment.update',
  'training.cert_template.clear',
  'training.cert_template.set',
  'training.item.create',
  'training.item.delete',
  'training.item.update',
  'training.item_resource.create',
  'training.item_resource.delete',
  'training.module.create',
  'training.module.update',
  'training.recording.delete',
  'training.recording.update',
  'training.reminder.send',
  'training.section.create',
  'training.section.delete',
  'training.section.update',

  // Platform-destined admin: deletion, privacy, merge, schools and staff roles (C15)
  'deletion.entity.delete',
  'deletion.request.review',
  'member.record.merge',
  'privacy.request.resolve',
  'school.record.update',
  'duty.grant',
  'duty.revoke',
  // The Staff role (13 Nov 2026): lib/staff.ts
  'staff.grant',
  'staff.activate',
  'staff.suspend',
  'staff.revoke',
  'staff.expire',
  'staff.settings.update',
  // Exports of personal data (Staff role phase 4): also in record_access_log
  'export.roster',
  'export.addon_manifest',
  'export.members',

  // Events admin: records by id inside an event (C16)
  'agreement.credential_sharing.set',
  'agreement.record.download',
  'agreement.recipient.correct',
  'agreement.recipient.sync',
  'agreement.suggestion.decide',
  'agreement.recipient.fix',
  'agreement.email_link.use',
  'agreement.reminder.send',
  'campaign.email.send',
  'credential.email.resend',
  'credential.record.revoke',
  'event_manager.assignment.create',
  'event_manager.assignment.delete',
  'event_participation.record.delete',
  'event_participation.record.update',
  'refund.preview.read',
  'registration.group_setup.finish',
  'registration.invoice.change',
  'registration.invoice.read',
  'registration.participant.crew_add',
  'survey.quote.withdraw',
  // C16 follow-up: registrations/[id]/payment-method (its change is catalogued under Registration)
  'registration.payment_method.read',
  // Payment documents for a place, downloaded by crew on someone's behalf
  'registration.receipt.read',
  'registration.paid_invoice.read',

  // Events admin: paperwork and communications under an event (C17)
  'agreement.participant.reissue',
  'credential.pd.issue',
  'event.reminder.send',
  'event_email.attachment.add',
  'event_email.catch_up.read',
  'event_email.catch_up.send',
  'event_email.message.send',
  'event_email.preview.read',
  'event_email.record.create',
  'event_email.record.delete',
  'event_email.record.update',
  'event_email.template.create',
  'event_email.template.delete',
  'event_email.template.update',
  'event_volunteer.assignment.create',
  'event_volunteer.assignment.delete',
  'participant.guardian_email.correct',
  'registration.invoice_paid.set',
  'registration.pay_link.send',
  'survey.distribution.change',
  'survey.distribution.read',
  'team_profile.invite.send',

  // Events admin: configuration under an event, the first tenantDb area (C18)
  'event_company.count.set',
  'event_company.placement.change',
  'event_offering.record.create',
  'event_offering.record.delete',
  // Event add-ons catalogue (docs/PLAN-event-add-ons-2026-11-17.md): app/api/admin/events/[slug]/addons/**
  'event_addon.record.create',
  'event_addon.record.update',
  'event_addon.record.delete',
  'event_addon.settings.update',
  'event_addon.booking.create',
  'event_addon.booking.update',
  'event_addon.booking.cancel',
  'merch.batch.commit',

  // S5 wave 7, registered ahead of the slices that write them (A10a, A10b).
  // Credentials by number (A10a): app/api/credentials/[number]/{events,visibility,pdf}
  'credential.event.create',
  'credential.visibility.set',
  'credential.pdf.read',
  // Team profiles by emailed link (A10a): app/api/team-profile/[token]
  'team_profile.record.save',
  // Surveys by emailed link (A10b): app/api/survey/[token]/** and survey/event/[slug]/link.
  // The member's own routes keep their member.survey.* names.
  'survey.response.open',
  'survey.response.save',
  'survey.response.submit',
  'survey.reminder.stop',
  'survey.link.send',
  // A volunteer's interest in an event (A10b): app/api/volunteer/interest
  'event_volunteer.interest.set',
  // The unsubscribe update (A10b) keeps email.unsubscribe.apply, above: a second
  // name for the same write would split its history.

  // The admin routes a Stellr Staff member can write (Staff role P3/P4, GATE-AUDIT).
  // Members: app/api/admin/members (POST) and members/[id]/**, but not the admin-only ones
  'member.record.create',
  'member.invite.send',
  'compliance.background_check.order',
  // Save, verify or unverify a teaching license; which one is in the metadata.
  'compliance.license.update',
  'compliance.license_document.attach',
  'event_participation.record.create',
  'membership.tier.grant',
  'membership.record.update',
  'membership.record.revoke',
  'agreement.volunteer.issue',
  'role.volunteer.grant',
  'role.volunteer.revoke',
  // A theme's default artwork, and the PD certificate: app/api/admin/{artwork-defaults,pd-certificate}
  'artwork.default_badge.save',
  'artwork.default_badge.delete',
  'artwork.default_certificate.save',
  'artwork.default_certificate.delete',
  'artwork.pd_certificate.save',
  'artwork.pd_certificate.delete',
  // Under an event: app/api/admin/events/[slug]/{awards,badge-templates,certificate-templates,credentials}
  'event.awards.assign',
  'event.awards.issue',
  'event.badge_template.save',
  'event.badge_template.delete',
  'event.certificate_template.save',
  'event.certificate_template.delete',
  'event.credentials.configure',
  'event.credentials.issue',
  // The check-in desk (…/check-in), one action whatever the tap; which tap is in the metadata.
  'event.check_in.desk_action',
  // Self check-in at the door by event code (app/api/check-in): nobody is signed in.
  'event.check_in.self_check_in',

  // Scholarships admin, Stellr-only in release 1 (C20b): app/api/admin/scholarships/[id]/**
  'scholarship.notes.update',
  'scholarship.offer.create',
  'scholarship.offer.decline',
  'scholarship.offer.cancel',
  'scholarship.offer_email.resend',
  'scholarship.refund.issue',
  'scholarship.refund_quote.read',
  // The admin-only routes (GATE-AUDIT remainder, critique item 2). Stellr's own chain,
  // unless the route acts on an event, which goes on its owner's.
  // The access model: app/api/admin/access/**
  'access.object.create',
  'access.object_content.attach',
  'access.object_content.detach',
  'access.object_manager.grant',
  'access.object_manager.revoke',
  'access.object_roster.add',
  'access.object_roster.remove',
  'access.member_role.grant',
  'access.member_role.revoke',
  'access.relation.set',
  // Background checks: re-poll every open one now, and the decision on a flagged report
  'compliance.background_check.sync',
  'compliance.background_check.adjudicate',
  // The Friday digest, sent to the signed-in admin on demand (app/api/admin/digest/send)
  'digest.preview.send',
  // Marketing email: app/api/admin/email/**
  'email.audience.preview',
  'email.campaign.create',
  'email.campaign.update',
  'email.campaign.archive',
  'email.campaign.test_send',
  'email.template.create',
  'email.template.update',
  'email.template.archive',
  // Signing: app/api/admin/esign/**
  'esign.maintenance.run',
  'esign.membership_backfill.run',
  'esign.state.update',
  'esign.template.create',
  'esign.template.approve',
  'esign.template.preview',
  'esign.template.upload',
  // A member record: app/api/admin/members/[id] (PATCH and DELETE)
  'member.record.update',
  'member.record.deactivate',
  // Sanity's event publish webhook: the access side of the event (app/api/admin/sanity/event-sync)
  'event.access.sync',
  // The store catalogue: app/api/admin/store/**
  'store.discount.save',
  'store.discount.delete',
  'store.product.create',
  'store.product.update',
  'store.product.archive',
  'store.product.printful_sync',
  'store.variant.create',
  'store.variant.update',
  'store.variant.delete',

  // The rest of C7's gate (S5 wave 9): mutating handlers that had no claimant.
  // The signer's side of Stellr signing (app/api/sign/**): nobody is signed in, the
  // emailed link or its session cookie is the key, and the recipient is the target.
  'esign.signer.session_open',
  'esign.signer.viewed',
  'esign.signer.consent',
  'esign.signer.submit',
  'esign.signer.decline',
  'esign.signer.copy_download',
  // A member's own store return, and the store manager's decision on it (app/api/store/returns)
  'store.return.request',
  'store.return.decide',
  // A member buying a membership themselves (app/api/stripe/membership-{checkout,invoice})
  'membership.checkout.start',
  'membership.invoice.send',
  // A teacher's Classroom Qualifier curriculum request (app/api/cq-lead): a HubSpot lead
  'lead.curriculum_request.create',
  // An organiser's team pages that can write as they read (app/api/members/teams/[id]/**,
  // app/api/registrations/[id]/spreadsheet): a join token minted, a ledger row filled in,
  // a roster sheet created. One event per answer, whatever it wrote. The payment-method
  // view keeps registration.payment_method.read, above.
  'registration.team.open',
  'registration.invoice_discount.read',
  'registration.roster.sheet_open',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

const CATALOGUE: ReadonlySet<string> = new Set(AUDIT_ACTIONS)

export function isCataloguedAction(action: string): action is AuditAction {
  return CATALOGUE.has(action)
}
