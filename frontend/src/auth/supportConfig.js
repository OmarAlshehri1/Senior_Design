export const SUPPORT_CONFIG = Object.freeze({
  contactLabel: null,
  contactHref: null,
});

export function getSupportPresentation(config = SUPPORT_CONFIG) {
  const contactLabel = typeof config?.contactLabel === 'string'
    ? config.contactLabel.trim()
    : '';
  const contactHref = typeof config?.contactHref === 'string'
    ? config.contactHref.trim()
    : '';

  return Object.freeze({
    instruction: 'Contact your system administrator.',
    contact: contactLabel && contactHref
      ? Object.freeze({ label: contactLabel, href: contactHref })
      : null,
  });
}
