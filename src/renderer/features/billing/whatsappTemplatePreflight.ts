import type { WhatsAppTemplate, WhatsAppTemplateUseCase } from "../../../shared/types";

const hasDocumentHeader = (template: WhatsAppTemplate) =>
  template.components.some((component) => {
    const row = component as { type?: string; format?: string };
    return String(row.type || "").toUpperCase() === "HEADER" && String(row.format || "").toUpperCase() === "DOCUMENT";
  });

const findApprovedTemplate = (templates: WhatsAppTemplate[], templateName: string, languageCode = "en") =>
  templates.find((template) =>
    template.name === templateName &&
    (template.languageCode === languageCode || !languageCode) &&
    String(template.status || "").toUpperCase() === "APPROVED"
  );

export async function ensureWhatsAppPdfTemplateReady(useCase: WhatsAppTemplateUseCase, fallbackTemplateName: string, documentLabel: string) {
  let templateName = fallbackTemplateName;
  let languageCode = "en";
  try {
    const manager = await window.autocare.getWhatsAppTemplateManager();
    const mapping = manager.mappings.find((item) => item.useCase === useCase);
    templateName = mapping?.templateName || fallbackTemplateName;
    languageCode = mapping?.languageCode || "en";
    const approved = findApprovedTemplate(manager.templates, templateName, languageCode);
    if (approved && hasDocumentHeader(approved)) return;
  } catch {
    return;
  }

  const syncedTemplates = await window.autocare.syncWhatsAppTemplates();
  const approved = findApprovedTemplate(syncedTemplates, templateName, languageCode);
  if (approved && hasDocumentHeader(approved)) return;
  if (approved) throw new Error("PDF templates require a Document header. Edit the template to add one.");

  throw new Error(
    `No approved template is mapped for this WhatsApp action. Sync or submit a template in Settings > WhatsApp. ${documentLabel}`
  );
}
