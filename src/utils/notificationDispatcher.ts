import { Asset, Site, Operator, AnomalyAlert, NotificationDispatch } from '../types';

// Simulates the multi-channel delivery a real fleet system would trigger off the
// back of a rules-engine alert (this prototype has no live SMS/email gateway
// wired up — no Twilio/SendGrid credentials — so dispatch is logged, not sent).
//
// Three channels, each covering a different failure mode:
//  1. Email to the site supervisor  -> permanent, auditable record for the office /
//     dealer, independent of anyone's phone.
//  2. SMS to the assigned operator's own phone -> reaches the person directly if
//     they carry it, with an automatic escalation to the supervisor's phone if no
//     operator is currently assigned to the unit.
//  3. In-Cab Console Alert on the machine itself -> modeled on Cat Product Link /
//     VisionLink (real Cat telematics push email/SMS/in-app alerts) and Cat Detect's
//     in-cab audio + seat-vibration alerts (real Cat safety telematics that fire
//     locally on the machine, not through a phone). This is the channel that still
//     reaches the operator if their phone was left in a truck, a locker, or has no
//     signal on site -- it doesn't depend on a phone existing at all.
export function dispatchNotification(
  alert: AnomalyAlert,
  asset: Asset | undefined,
  site: Site | undefined,
  operator: Operator | undefined
): NotificationDispatch[] {
  const dispatches: NotificationDispatch[] = [];

  if (site) {
    dispatches.push({
      channel: 'Email',
      recipient: `${site.supervisor} <${site.supervisor_email}>`,
      status: 'Sent',
      detail: 'Logged to the fleet office for record-keeping and dealer coordination.',
    });
  }

  if (operator) {
    dispatches.push({
      channel: 'SMS',
      recipient: `${operator.name} (${operator.contact})`,
      status: 'Sent',
      detail: 'Direct text sent to the operator currently assigned to this unit.',
    });
  } else if (site) {
    dispatches.push({
      channel: 'SMS',
      recipient: `${site.supervisor} (${site.supervisor_phone})`,
      status: 'Sent',
      detail: 'No operator assigned to this unit — escalated by SMS to the site supervisor instead.',
    });
  }

  dispatches.push({
    channel: 'In-Cab Console Alert',
    recipient: asset ? `${asset.id} on-board telematics display` : 'Unit on-board display',
    status: 'Sent',
    detail: 'Audible alarm + dashboard banner triggered directly on the machine’s console (Cat Product Link-style) — reaches whoever is in the cab even without a phone.',
  });

  return dispatches;
}
