import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X
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

type WhatsAppQuickReply = {
  id: string;
  title: string;
  body: string;
};

const QUICK_REPLY_STORAGE_KEY = "autocare24.whatsapp.quickReplies.v1";

const DEFAULT_QUICK_REPLIES: WhatsAppQuickReply[] = [
  {
    id: "greeting",
    title: "Greeting",
    body: "Hi {customer},\nThis is {business}. How can we help you today?"
  },
  {
    id: "service-update",
    title: "Service update",
    body: "Hi {customer},\nYour {vehicle} service update is ready. Please let us know if you need any changes."
  },
  {
    id: "payment-reminder",
    title: "Payment reminder",
    body: "Hi {customer},\nThis is a payment reminder from {business}. Please contact us for the pending balance details."
  }
];

const safeQuickReplies = (value: unknown): WhatsAppQuickReply[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const item = row as Partial<WhatsAppQuickReply>;
      return {
        id: String(item.id || ""),
        title: String(item.title || "").trim(),
        body: String(item.body || "").trim()
      };
    })
    .filter((row) => row.id && row.title && row.body)
    .slice(0, 30);
};

const readQuickReplies = () => {
  if (typeof window === "undefined") return DEFAULT_QUICK_REPLIES;
  try {
    const stored = safeQuickReplies(JSON.parse(window.localStorage.getItem(QUICK_REPLY_STORAGE_KEY) || "[]"));
    return stored.length ? stored : DEFAULT_QUICK_REPLIES;
  } catch {
    return DEFAULT_QUICK_REPLIES;
  }
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

const contactPreview = (customer: WhatsAppContact) => {
  if (customer.conversation?.lastMessagePreview) return customer.conversation.lastMessagePreview;
  return [
    customer.customerCode,
    customer.whatsappPhone.display,
    plural(customer.vehicles.length, "vehicle")
  ].filter(Boolean).join(" - ");
};

const renderQuickReply = (body: string, customer: CustomerWithVehicles | null, businessName: string, vehicles: string) =>
  body
    .replace(/\{customer\}/gi, customer?.name || "Customer")
    .replace(/\{business\}/gi, businessName || "your business")
    .replace(/\{vehicle\}/gi, vehicles || "vehicle");

const formatTime = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatTemplateLabel = (template: WhatsAppTemplate) =>
  `${template.name}${template.languageCode ? ` (${template.languageCode})` : ""}`;

const templateKey = (template: WhatsAppTemplate) => `${template.name}::${template.languageCode}`;
const WHATSAPP_TEMPLATE_EMPTY_VALUE = "-";

type WhatsAppTemplateComponent = {
  type?: unknown;
  text?: unknown;
  example?: { body_text?: unknown };
  parameters?: unknown;
  localizable_params?: unknown;
};

const templateBodyParameterCount = (template: WhatsAppTemplate | null) => {
  const body = template?.components.find((component) =>
    String((component as WhatsAppTemplateComponent)?.type || "").toUpperCase() === "BODY"
  ) as WhatsAppTemplateComponent | undefined;
  if (!body) return 0;
  const text = String(body.text || "");
  const textMatches = text.match(/{{\s*[^{}\s]+\s*}}/g);
  if (textMatches?.length) return textMatches.length;
  const exampleRows = body.example?.body_text;
  if (Array.isArray(exampleRows)) {
    const firstRow = exampleRows[0];
    return Array.isArray(firstRow) ? firstRow.length : exampleRows.length;
  }
  if (Array.isArray(body.parameters)) return body.parameters.length;
  if (Array.isArray(body.localizable_params)) return body.localizable_params.length;
  return 0;
};

const templateValue = (value: unknown, fallback = WHATSAPP_TEMPLATE_EMPTY_VALUE) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
};

const chatTemplateVariables = (
  template: WhatsAppTemplate | null,
  customer: CustomerWithVehicles,
  businessName: string,
  vehicles: string,
  messageText: string
) => {
  const customerName = templateValue(customer.name, "Customer");
  const business = templateValue(businessName, "Autocare24");
  const vehicle = templateValue(vehicles);
  const message = templateValue(messageText);
  const expected = templateBodyParameterCount(template);
  const values = expected > 0 && expected <= 3
    ? [customerName, business, message]
    : [customerName, business, vehicle, message];
  if (expected <= 0) return values;
  return [...values, ...Array(Math.max(0, expected - values.length)).fill(WHATSAPP_TEMPLATE_EMPTY_VALUE)].slice(0, expected);
};

const statusLabel = (status: string) =>
  status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const chatDeleteErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/No handler registered for 'whatsapp:(deleteMessage|clearConversationHistory)'/i.test(message)) {
    return "Restart the app once to enable the new WhatsApp delete option.";
  }
  return message || fallback;
};

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
  const [historyBusy, setHistoryBusy] = useState("");
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [quickReplies, setQuickReplies] = useState<WhatsAppQuickReply[]>(readQuickReplies);
  const [quickReplyEditorOpen, setQuickReplyEditorOpen] = useState(false);
  const [editingQuickReplyId, setEditingQuickReplyId] = useState("");
  const [quickReplyTitle, setQuickReplyTitle] = useState("");
  const [quickReplyBody, setQuickReplyBody] = useState("");

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
            customer.customerCode,
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
  const providerLabel = status?.provider === "ycloud" ? "YCloud" : "Meta";
  const statusMessage = status?.message || "WhatsApp Business API status is not loaded yet.";
  const customRepliesReady = Boolean(selected && canSendText);
  const sendDisabled = Boolean(
    sending ||
    !selected ||
    !message.trim() ||
    !apiReady ||
    (mode === "text" && !canSendText) ||
    (mode === "template" && !selectedTemplate)
  );
  const sendDisabledReason = !selected
    ? "Select a customer first."
    : !apiReady
      ? status?.message || "WhatsApp Business API not configured."
      : mode === "text" && !canSendText
        ? "Customer reply required before sending custom replies."
        : mode === "template" && !selectedTemplate
          ? "Sync and select an approved WhatsApp template first."
          : "";

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
    try {
      window.localStorage.setItem(QUICK_REPLY_STORAGE_KEY, JSON.stringify(quickReplies));
    } catch {
      // Local quick replies are a convenience feature; messaging still works without storage.
    }
  }, [quickReplies]);

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

  const startNewQuickReply = () => {
    setEditingQuickReplyId("");
    setQuickReplyTitle("");
    setQuickReplyBody("");
    setQuickReplyEditorOpen(true);
  };

  const editQuickReply = (reply: WhatsAppQuickReply) => {
    setEditingQuickReplyId(reply.id);
    setQuickReplyTitle(reply.title);
    setQuickReplyBody(reply.body);
    setQuickReplyEditorOpen(true);
  };

  const closeQuickReplyEditor = () => {
    setQuickReplyEditorOpen(false);
    setEditingQuickReplyId("");
    setQuickReplyTitle("");
    setQuickReplyBody("");
  };

  const saveQuickReply = () => {
    const title = quickReplyTitle.trim();
    const body = quickReplyBody.trim();
    if (!title || !body) return notify("Reply name and message are required.");
    setQuickReplies((current) => {
      if (editingQuickReplyId) {
        return current.map((reply) => (reply.id === editingQuickReplyId ? { ...reply, title, body } : reply));
      }
      return [{ id: `reply-${Date.now()}`, title, body }, ...current].slice(0, 30);
    });
    closeQuickReplyEditor();
    notify("Custom WhatsApp reply saved.");
  };

  const deleteQuickReply = (replyId: string) => {
    setQuickReplies((current) => current.filter((reply) => reply.id !== replyId));
    if (editingQuickReplyId === replyId) closeQuickReplyEditor();
    notify("Custom WhatsApp reply removed.");
  };

  const applyQuickReply = (reply: WhatsAppQuickReply) => {
    if (!selected) return notify("Select a customer with WhatsApp number first.");
    if (!canSendText) {
      return notify("Custom replies unlock after the customer replies. Send an approved template first.");
    }
    setMessage(renderQuickReply(reply.body, selected, settings.businessName, selectedVehicleSummary));
    setMode("text");
  };

  const mergeConversation = (conversation: WhatsAppConversation) => {
    setConversations((current) => {
      const exists = current.some((row) => row.id === conversation.id);
      return exists ? current.map((row) => (row.id === conversation.id ? conversation : row)) : [conversation, ...current];
    });
  };

  const deleteMessage = async (row: WhatsAppMessage) => {
    if (!selectedConversation) return notify("Select a chat first.");
    if (!window.confirm("Delete this message from app chat history?")) return;
    setHistoryBusy(`message:${row.id}`);
    try {
      const result = await window.autocare.deleteWhatsAppMessage(selectedConversation.id, row.id);
      setMessages((current) => current.filter((messageRow) => messageRow.id !== row.id));
      mergeConversation(result.conversation);
      notify("WhatsApp message deleted from app history.");
    } catch (error) {
      notify(chatDeleteErrorMessage(error, "Unable to delete WhatsApp message."));
    } finally {
      setHistoryBusy("");
    }
  };

  const clearChatHistory = async () => {
    if (!selectedConversation) return notify("Select a chat first.");
    if (!messages.length) return notify("No messages to delete in this chat.");
    if (!window.confirm("Delete all messages in this chat from app history?")) return;
    setHistoryBusy("conversation");
    try {
      const result = await window.autocare.clearWhatsAppConversationHistory(selectedConversation.id);
      setMessages([]);
      mergeConversation(result.conversation);
      notify(`Deleted ${plural(result.deletedCount, "WhatsApp message")} from app history.`);
    } catch (error) {
      notify(chatDeleteErrorMessage(error, "Unable to clear WhatsApp chat history."));
    } finally {
      setHistoryBusy("");
    }
  };

  const sendMessage = async () => {
    if (!selected) return notify("Select a customer with WhatsApp number first.");
    if (!apiReady) return notify(status?.message || "WhatsApp Business API not configured.");
    const trimmed = message.trim();
    if (!trimmed) return notify("Message is required.");
    if (mode === "text" && !canSendText) return notify("Use an approved template first. Normal replies unlock after the customer messages you.");
    if (mode === "template" && !selectedTemplate) {
      return notify(canSendText ? "Sync and select an approved WhatsApp template first." : "Send an approved template first. Custom replies unlock after the customer replies.");
    }
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
              variables: chatTemplateVariables(selectedTemplate, selected, settings.businessName, selectedVehicleSummary, trimmed)
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
            <input placeholder="Search customer ID, customer, phone, vehicle" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
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
                <strong>{customer.name || customer.whatsappPhone.display}</strong>
                <span>{contactPreview(customer)}</span>
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
            {apiReady ? `${providerLabel} connected` : `${providerLabel} not configured`}
          </span>
          <span className={status?.webhookReady ? "whatsapp-api-status connected" : "whatsapp-api-status muted"}>
            <ShieldCheck size={16} />
            {status?.webhookReady ? "Webhook ready" : "Webhook pending"}
          </span>
          <span className="whatsapp-status-message" title={statusMessage}>{statusMessage}</span>
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
            <button
              className="whatsapp-icon-button danger"
              onClick={() => void clearChatHistory()}
              disabled={!selectedConversation || !messages.length || Boolean(historyBusy)}
              title="Clear chat history"
              aria-label="Clear chat history"
            >
              <Trash2 size={18} />
            </button>
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
                  <div className="whatsapp-message-meta-row">
                    <small className={row.status === "failed" ? "failed" : ""}>
                      <Clock3 size={13} />
                      {[formatTime(row.timestamp || row.createdAt), statusLabel(row.status), row.errorMessage].filter(Boolean).join(" - ")}
                    </small>
                    <button
                      type="button"
                      className="whatsapp-message-delete"
                      onClick={() => void deleteMessage(row)}
                      disabled={Boolean(historyBusy)}
                      title="Delete message"
                      aria-label="Delete message"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
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

        <div className="whatsapp-quick-replies">
          <div className="whatsapp-quick-replies-head">
            <span>
              <MessageCircle size={15} />
              Custom replies
            </span>
            {!canSendText && selected && <em>Customer reply needed</em>}
            <button type="button" onClick={startNewQuickReply}>
              <Plus size={15} />
              New
            </button>
          </div>
          <div className="whatsapp-quick-reply-list">
            {quickReplies.map((reply) => (
              <span key={reply.id} className="whatsapp-quick-reply-chip">
                <button
                  type="button"
                  onClick={() => applyQuickReply(reply)}
                  disabled={!customRepliesReady}
                  title={customRepliesReady ? reply.body : "Customer reply required before sending custom replies."}
                >
                  {reply.title}
                </button>
                <button type="button" className="whatsapp-quick-reply-edit" onClick={() => editQuickReply(reply)} title="Edit reply" aria-label={`Edit ${reply.title}`}>
                  <Pencil size={14} />
                </button>
              </span>
            ))}
          </div>
          {quickReplyEditorOpen && (
            <div className="whatsapp-quick-reply-editor">
              <input value={quickReplyTitle} onChange={(event) => setQuickReplyTitle(event.currentTarget.value)} placeholder="Reply name" />
              <textarea value={quickReplyBody} onChange={(event) => setQuickReplyBody(event.currentTarget.value)} placeholder="Message" />
              <button type="button" className="save" onClick={saveQuickReply}>
                <Save size={15} />
                Save
              </button>
              {editingQuickReplyId && (
                <button type="button" className="danger" onClick={() => deleteQuickReply(editingQuickReplyId)} title="Delete reply" aria-label="Delete reply">
                  <Trash2 size={15} />
                </button>
              )}
              <button type="button" className="ghost" onClick={closeQuickReplyEditor} title="Close" aria-label="Close custom reply editor">
                <X size={15} />
              </button>
            </div>
          )}
        </div>

        <div className="whatsapp-custom-composer">
          <textarea
            value={message}
            disabled={!selected || sending}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder={mode === "template" ? "Template variables / preview message" : "Type a reply"}
          />
          <button className="whatsapp-send-button" onClick={() => void sendMessage()} disabled={sendDisabled} title={sendDisabledReason}>
            <Send size={21} />
            <span>{sending ? "Sending" : mode === "template" ? "Send Template" : "Send Reply"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
