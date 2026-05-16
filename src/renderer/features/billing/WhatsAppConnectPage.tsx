import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BusinessSettings,
  CustomerWithVehicles,
  WhatsAppBusinessStatus,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppMessageMode,
  WhatsAppTemplate
} from "../../../shared/types";

type WhatsAppPhone = {
  valid: boolean;
  display: string;
  value: string;
};

type WhatsAppContact = CustomerWithVehicles & {
  whatsappPhone: WhatsAppPhone;
  conversation?: WhatsAppConversation;
  searchText: string;
};

const normalizeWhatsAppPhone = (phone: string | undefined | null): WhatsAppPhone => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return { valid: true, display: digits, value: `91${digits}` };
  if (digits.length >= 8 && digits.length <= 15) return { valid: true, display: digits.startsWith("91") ? digits.slice(2) : digits, value: digits };
  return { valid: false, display: "", value: "" };
};

const plural = (count: number, singular: string, pluralLabel = `${singular}s`) => `${count} ${count === 1 ? singular : pluralLabel}`;

const vehicleSummary = (customer: CustomerWithVehicles) =>
  customer.vehicles
    .map((vehicle) => [vehicle.registrationNumber, vehicle.make, vehicle.model].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" | ");

const customerInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || "";
  const second = parts[1] || "";
  return (second ? `${first[0] ?? ""}${second[0] ?? ""}` : first.slice(0, 2) || "WA").toUpperCase();
};

const defaultMessage = (customer: CustomerWithVehicles | null, businessName: string) =>
  customer ? [`Hi ${customer.name || "Customer"},`, `This is ${businessName || "your business"}.`].join("\n") : "";

const formatTime = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatTemplateLabel = (template: WhatsAppTemplate) =>
  `${template.name}${template.languageCode ? ` (${template.languageCode})` : ""}`;

const templateKey = (template: WhatsAppTemplate) => `${template.name}::${template.languageCode}`;

const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function WhatsAppConnectPage({
  settings,
  refreshKey,
  notify
}: {
  settings: BusinessSettings;
  refreshKey: number;
  notify: (message: string) => void;
}) {
  const [customers, setCustomers] = useState<CustomerWithVehicles[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [status, setStatus] = useState<WhatsAppBusinessStatus | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<WhatsAppMessageMode>("template");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [loadError, setLoadError] = useState("");

  const approvedTemplates = useMemo(
    () => templates.filter((template) => template.status.toUpperCase() === "APPROVED"),
    [templates]
  );

  const conversationByPhone = useMemo(() => {
    const map = new Map<string, WhatsAppConversation>();
    conversations.forEach((conversation) => map.set(conversation.phone, conversation));
    return map;
  }, [conversations]);

  const conversationByCustomer = useMemo(() => {
    const map = new Map<string, WhatsAppConversation>();
    conversations.forEach((conversation) => {
      if (conversation.customerId) map.set(conversation.customerId, conversation);
    });
    return map;
  }, [conversations]);

  const contacts = useMemo<WhatsAppContact[]>(
    () =>
      customers
        .map((customer) => {
          const whatsappPhone = normalizeWhatsAppPhone(customer.phone);
          const conversation = conversationByCustomer.get(customer.id) || conversationByPhone.get(whatsappPhone.value);
          const searchText = [
            customer.name,
            customer.phone,
            customer.email,
            customer.gstin,
            customer.address,
            conversation?.lastMessagePreview,
            vehicleSummary(customer),
            ...customer.vehicles.flatMap((vehicle) => [vehicle.registrationNumber, vehicle.vehicleType, vehicle.make, vehicle.model, vehicle.color])
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return { ...customer, whatsappPhone, conversation, searchText };
        })
        .filter((customer) => customer.whatsappPhone.valid),
    [conversationByCustomer, conversationByPhone, customers]
  );

  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((customer) => customer.searchText.includes(needle));
  }, [contacts, query]);

  const selected = contacts.find((customer) => customer.id === selectedId) || null;
  const selectedConversation = selected?.conversation || null;
  const selectedVehicleSummary = selected ? vehicleSummary(selected) : "";
  const skippedCount = Math.max(0, customers.length - contacts.length);
  const selectedTemplate = approvedTemplates.find((template) => templateKey(template) === selectedTemplateKey) || approvedTemplates[0] || null;
  const canSendText = Boolean(selectedConversation?.canSendFreeform);
  const apiReady = Boolean(status?.configured);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [customerRows, whatsappStatus, conversationRows, templateRows] = await Promise.all([
        window.autocare.listCustomers(),
        window.autocare.getWhatsAppStatus(),
        window.autocare.listWhatsAppConversations(),
        window.autocare.listWhatsAppTemplates()
      ]);
      setCustomers(customerRows);
      setStatus(whatsappStatus);
      setConversations(conversationRows);
      setTemplates(templateRows);
      const firstApproved = templateRows.find((template) => template.status.toUpperCase() === "APPROVED");
      if (firstApproved) setSelectedTemplateKey(templateKey(firstApproved));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load WhatsApp Business data.";
      setLoadError(message);
      notify(message);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!contacts.length) {
      setSelectedId("");
      return;
    }
    const first = contacts[0];
    if (!contacts.some((customer) => customer.id === selectedId) && first) setSelectedId(first.id);
  }, [contacts, selectedId]);

  useEffect(() => {
    setMessage(defaultMessage(selected, settings.businessName));
    setMode(selectedConversation?.canSendFreeform ? "text" : "template");
  }, [selected?.id, selectedConversation?.id, selectedConversation?.canSendFreeform, settings.businessName]);

  useEffect(() => {
    if (!selectedConversation?.id) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    window.autocare
      .listWhatsAppMessages(selectedConversation.id)
      .then((result) => {
        setMessages(result.messages);
        setConversations((current) => current.map((conversation) => (conversation.id === result.conversation.id ? result.conversation : conversation)));
      })
      .catch((error) => notify(error instanceof Error ? error.message : "Unable to load WhatsApp messages."))
      .finally(() => setLoadingMessages(false));
  }, [notify, selectedConversation?.id]);

  const syncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const synced = await window.autocare.syncWhatsAppTemplates();
      setTemplates(synced);
      const firstApproved = synced.find((template) => template.status.toUpperCase() === "APPROVED");
      if (firstApproved) setSelectedTemplateKey(templateKey(firstApproved));
      const nextStatus = await window.autocare.getWhatsAppStatus();
      setStatus(nextStatus);
      notify(`Synced ${plural(synced.length, "WhatsApp template")}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to sync WhatsApp templates.");
    } finally {
      setSyncingTemplates(false);
    }
  };

  const mergeConversation = (conversation: WhatsAppConversation) => {
    setConversations((current) => {
      const exists = current.some((row) => row.id === conversation.id);
      return exists ? current.map((row) => (row.id === conversation.id ? conversation : row)) : [conversation, ...current];
    });
  };

  const sendMessage = async () => {
    if (!selected) return notify("Select a customer with WhatsApp number first.");
    if (!apiReady) return notify(status?.message || "WhatsApp Business API not configured.");
    const trimmed = message.trim();
    if (!trimmed) return notify("Message is required.");
    if (mode === "text" && !canSendText) return notify("Use an approved template first. Normal replies unlock after the customer messages you.");
    if (mode === "template" && !selectedTemplate) return notify("Sync and select an approved WhatsApp template first.");
    setSending(true);
    try {
      const result = await window.autocare.sendWhatsAppMessage({
        phone: selected.whatsappPhone.value,
        customerId: selected.id,
        customerName: selected.name,
        mode,
        text: trimmed,
        ...(mode === "template" && selectedTemplate
          ? {
              templateName: selectedTemplate.name,
              languageCode: selectedTemplate.languageCode,
              variables: [
                selected.name,
                settings.businessName || "Autocare24",
                selectedVehicleSummary,
                trimmed
              ].filter(Boolean)
            }
          : {}),
        source: { type: "customer", id: selected.id }
      });
      mergeConversation(result.conversation);
      setMessages((current) => [...current, result.message]);
      setMessage(defaultMessage(selected, settings.businessName));
      notify("WhatsApp Business message sent.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to send WhatsApp message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="whatsapp-connect-layout">
      <section className="whatsapp-chat-list-panel">
        <div className="whatsapp-list-header">
          <div>
            <h2>Chats</h2>
            <p>{loading ? "Loading..." : `${plural(contacts.length, "valid customer")} ready`}</p>
          </div>
          <button className="whatsapp-icon-button" onClick={() => void load()} disabled={loading} title="Refresh chats" aria-label="Refresh chats">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="whatsapp-list-search-row">
          <div className="search-box whatsapp-chat-search">
            <Search size={18} />
            <input placeholder="Search customer, phone, vehicle" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          </div>
        </div>

        <div className="whatsapp-contact-counts">
          <span>{loading ? "Loading contacts" : `${plural(contacts.length, "valid number")}`}</span>
          {skippedCount > 0 && <span>{plural(skippedCount, "missing phone", "missing phones")}</span>}
        </div>

        <div className="record-list whatsapp-contact-list">
          {filteredContacts.map((customer) => (
            <button
              key={customer.id}
              className={selectedId === customer.id ? "record whatsapp-contact-record active" : "record whatsapp-contact-record"}
              onClick={() => setSelectedId(customer.id)}
            >
              <span className="whatsapp-contact-avatar">{customerInitials(customer.name)}</span>
              <span className="whatsapp-contact-main">
                <strong>{customer.name}</strong>
                <span>{customer.conversation?.lastMessagePreview || `${customer.whatsappPhone.display} - ${plural(customer.vehicles.length, "vehicle")}`}</span>
              </span>
              <span className="whatsapp-contact-meta">
                {customer.conversation?.lastMessageAt && <em>{formatTime(customer.conversation.lastMessageAt)}</em>}
                {Boolean(customer.conversation?.unreadCount) && <b>{customer.conversation?.unreadCount}</b>}
              </span>
            </button>
          ))}
          {!filteredContacts.length && (
            <div className="empty-state subtle">
              {loadError || (query ? "No WhatsApp contacts match this search." : "No customers with valid WhatsApp numbers.")}
            </div>
          )}
        </div>
      </section>

      <section className="whatsapp-custom-chat-panel">
        <div className="whatsapp-business-status-row">
          <span className={apiReady ? "whatsapp-api-status connected" : "whatsapp-api-status warning"}>
            {apiReady ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {apiReady ? "Business API connected" : "Business API not configured"}
          </span>
          <span className={status?.webhookReady ? "whatsapp-api-status connected" : "whatsapp-api-status muted"}>
            <ShieldCheck size={16} />
            {status?.webhookReady ? "Webhook ready" : "Webhook pending"}
          </span>
          <button className="ghost-button small" onClick={() => void syncTemplates()} disabled={syncingTemplates || !apiReady}>
            <RefreshCw size={15} />
            {syncingTemplates ? "Syncing" : "Sync templates"}
          </button>
        </div>

        <div className="whatsapp-chat-header">
          <span className="whatsapp-chat-avatar">{selected ? customerInitials(selected.name) : <UserRound size={24} />}</span>
          <div className="whatsapp-chat-title">
            <h2>{selected ? selected.name : "Select a customer chat"}</h2>
            <p>
              {selected
                ? `${selected.whatsappPhone.display}${selectedVehicleSummary ? ` - ${selectedVehicleSummary}` : ""}`
                : "Only customers with valid WhatsApp numbers appear here."}
            </p>
          </div>
          <div className="whatsapp-chat-actions">
            <button className="whatsapp-icon-button" onClick={() => void load()} disabled={loading} title="Refresh WhatsApp data" aria-label="Refresh WhatsApp data">
              <RefreshCw size={19} />
            </button>
          </div>
        </div>

        <div className="whatsapp-custom-thread">
          {selected ? (
            <>
              <div className="whatsapp-secure-banner">
                <ShieldCheck size={16} />
                <span>Messages are sent by WhatsApp Business Cloud API. Customer replies appear here after webhook delivery.</span>
              </div>

              {loadingMessages && <div className="whatsapp-thread-date">Loading messages...</div>}

              {!loadingMessages && !messages.length && (
                <div className="whatsapp-custom-empty">
                  <MessageCircle size={34} />
                  <strong>No messages yet</strong>
                  <span>{canSendText ? "Type a reply below." : "Start with an approved template message."}</span>
                </div>
              )}

              {messages.map((row) => (
                <div key={row.id} className={row.direction === "inbound" ? "whatsapp-message-bubble incoming" : "whatsapp-message-bubble outgoing"}>
                  <span>{row.textBody || (row.templateName ? `Template: ${row.templateName}` : "WhatsApp message")}</span>
                  <small className={row.status === "failed" ? "failed" : ""}>
                    <Clock3 size={13} />
                    {[formatTime(row.timestamp || row.createdAt), statusLabel(row.status), row.errorMessage].filter(Boolean).join(" - ")}
                  </small>
                </div>
              ))}
            </>
          ) : (
            <div className="whatsapp-custom-empty">
              <MessageCircle size={34} />
              <strong>No chat selected</strong>
              <span>Select a customer from the left list.</span>
            </div>
          )}
        </div>

        <div className="whatsapp-template-row">
          <button className={mode === "template" ? "active" : ""} onClick={() => setMode("template")} disabled={!selected}>
            <Sparkles size={15} />
            Template
          </button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")} disabled={!selected || !canSendText}>
            Reply
          </button>
          {mode === "template" && (
            <select value={selectedTemplate ? templateKey(selectedTemplate) : ""} onChange={(event) => setSelectedTemplateKey(event.currentTarget.value)} disabled={!approvedTemplates.length}>
              {approvedTemplates.length ? (
                approvedTemplates.map((template) => (
                  <option key={templateKey(template)} value={templateKey(template)}>
                    {formatTemplateLabel(template)}
                  </option>
                ))
              ) : (
                <option value="">No approved templates synced</option>
              )}
            </select>
          )}
          {!canSendText && <span className="whatsapp-policy-note">Template required until customer replies.</span>}
        </div>

        <div className="whatsapp-custom-composer">
          <textarea
            value={message}
            disabled={!selected || sending}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder={mode === "template" ? "Template variables / preview message" : "Type a reply"}
          />
          <button className="whatsapp-send-button" onClick={() => void sendMessage()} disabled={sending || !selected || !message.trim() || !apiReady}>
            <Send size={21} />
            <span>{sending ? "Sending" : mode === "template" ? "Send Template" : "Send Reply"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
