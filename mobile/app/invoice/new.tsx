import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppButton } from "../../src/components/AppButton";
import { MetricCard } from "../../src/components/MetricCard";
import { MetricGrid } from "../../src/components/MetricGrid";
import { Screen } from "../../src/components/Screen";
import {
  createInvoice,
  fetchBusinessSettings,
  fetchCustomers,
  fetchInventoryDashboard,
  fetchServices,
  fetchVehicles
} from "../../src/services/cloudApi";
import { useRequirePermission } from "../../src/hooks/useRequireOwner";
import { useSession } from "../../src/providers/SessionProvider";
import { hasPermission } from "../../src/services/permissions";
import { colors, radius } from "../../src/theme";
import { calculateInvoiceTotals, DEFAULT_SAC_CODE, money, normalizeSacCode } from "../../src/utils/billingMath";
import { formatMoney, titleCase } from "../../src/utils/format";
import { normalizeWarrantyText, parseWarrantyDurationMonths, warrantyDurationLabel } from "../../src/utils/warranty";
import type {
  Customer,
  InventoryItem,
  InvoiceCreateInput,
  InvoiceItemInput,
  InvoiceMode,
  PaymentMode,
  ServiceItem,
  TaxScope,
  Vehicle,
  VehicleType
} from "../../src/types/cloud";

const PAYMENT_MODES: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const VEHICLE_TYPES: VehicleType[] = ["car", "bike", "other"];

type DraftItem = InvoiceItemInput & { key: string };

const todayIso = () => {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const emptyItem = (gstRate: number): DraftItem => ({
  key: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  description: "",
  quantity: 1,
  unitPrice: 0,
  gstRate,
  sacCode: DEFAULT_SAC_CODE,
  warrantyIncluded: false,
  warrantyDurationMonths: 0,
  warrantyText: ""
});

const warrantyFieldsFromService = (service: ServiceItem): Pick<InvoiceItemInput, "warrantyIncluded" | "warrantyDurationMonths" | "warrantyText"> => {
  const durationMonths = parseWarrantyDurationMonths(service.warrantyDurationMonths || service.warrantyText);
  if (!service.warrantyEnabled || !durationMonths) return { warrantyIncluded: false, warrantyDurationMonths: 0, warrantyText: "" };
  return {
    warrantyIncluded: true,
    warrantyDurationMonths: durationMonths,
    warrantyText: normalizeWarrantyText(service.warrantyText, durationMonths)
  };
};

export default function NewInvoiceScreen() {
  const guard = useRequirePermission("billing.create");
  const session = useSession();
  const queryClient = useQueryClient();
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>("gst");
  const [taxScope, setTaxScope] = useState<TaxScope>("intra");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [customerQuery, setCustomerQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "", gstin: "", address: "", customerCode: "" });
  const [vehicle, setVehicle] = useState({ registrationNumber: "", vehicleType: "car" as VehicleType, make: "", model: "", color: "" });
  const [items, setItems] = useState<DraftItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("UPI");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");

  const enabled = Boolean(session.user && session.token && session.userToken && session.approvalStatus === "APPROVED");
  const canReadSettings = hasPermission(session.user, "billing.view") || hasPermission(session.user, "settings.manage");
  const canReadCustomers = hasPermission(session.user, "customers.view");
  const canReadVehicles = hasPermission(session.user, "customers.view") || hasPermission(session.user, "billing.view") || hasPermission(session.user, "jobCards.view");
  const canReadServices = hasPermission(session.user, "services.view");
  const canReadStock = hasPermission(session.user, "stock.view");
  const settingsQuery = useQuery({
    queryKey: ["business-settings", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchBusinessSettings(session.cloudUrl, session.token, session.userToken),
    enabled: enabled && canReadSettings
  });
  const customersQuery = useQuery({
    queryKey: ["customers", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchCustomers(session.cloudUrl, session.token, session.userToken),
    enabled: enabled && canReadCustomers
  });
  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchVehicles(session.cloudUrl, session.token, session.userToken),
    enabled: enabled && canReadVehicles
  });
  const servicesQuery = useQuery({
    queryKey: ["services", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchServices(session.cloudUrl, session.token, session.userToken),
    enabled: enabled && canReadServices
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory-dashboard", session.cloudUrl, session.token, session.userToken],
    queryFn: () => fetchInventoryDashboard(session.cloudUrl, session.token, session.userToken),
    enabled: enabled && canReadStock
  });

  const defaultGstRate = numberValue(settingsQuery.data?.defaultGstRate || 18);

  useEffect(() => {
    if (settingsQuery.data?.defaultTaxScope === "inter" || settingsQuery.data?.defaultTaxScope === "intra") {
      setTaxScope(settingsQuery.data.defaultTaxScope);
    }
  }, [settingsQuery.data?.defaultTaxScope]);

  const totals = useMemo(() => calculateInvoiceTotals(invoiceMode, taxScope, items, discount), [discount, invoiceMode, items, taxScope]);
  const retailItems = useMemo(() => (inventoryQuery.data?.items || []).filter((item) => item.type === "retail" && item.active !== false), [inventoryQuery.data?.items]);
  const customerMatches = useMemo(() => filterCustomers(customersQuery.data || [], customerQuery), [customerQuery, customersQuery.data]);
  const serviceMatches = useMemo(() => filterServices(servicesQuery.data || [], serviceQuery), [serviceQuery, servicesQuery.data]);
  const stockMatches = useMemo(() => filterStock(retailItems, stockQuery), [retailItems, stockQuery]);
  const vehicleOptions = useMemo(() => {
    const rows = vehiclesQuery.data || [];
    if (!selectedCustomerId) return rows.slice(0, 8);
    return rows.filter((row) => String(row.customerId || "") === selectedCustomerId);
  }, [selectedCustomerId, vehiclesQuery.data]);

  const validationError = useMemo(() => {
    if (!session.isOnline) return "Internet required to create final invoice number.";
    if (session.approvalStatus !== "APPROVED") return "This phone is not approved for cloud billing.";
    if (!customer.name.trim()) return "Customer name is required.";
    if (!vehicle.registrationNumber.trim()) return "Vehicle number is required.";
    if (!items.length) return "Add at least one invoice item.";
    const invalidItem = items.find((item) => !item.description.trim() || numberValue(item.quantity) <= 0 || numberValue(item.unitPrice) < 0);
    if (invalidItem) return "Every item needs description, quantity, and valid price.";
    if (money(discount) > money(totals.subTotal)) return "Discount cannot be greater than subtotal.";
    if (money(paidAmount) > money(totals.grandTotal)) return "Entered paid amount is greater than billed amount.";
    return "";
  }, [customer.name, discount, items, paidAmount, session.approvalStatus, session.isOnline, totals.grandTotal, totals.subTotal, vehicle.registrationNumber]);

  const createMutation = useMutation({
    mutationFn: () => createInvoice(session.cloudUrl, session.token, session.userToken, buildPayload()),
    onSuccess: async (invoice) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-dashboard"] })
      ]);
      Alert.alert("Invoice created", `Invoice ${invoice.invoiceNumber || ""} was created.`);
      router.replace({ pathname: "/invoice/[id]", params: { id: invoice.id } });
    },
    onError: (error) => {
      Alert.alert("Unable to create invoice", error instanceof Error ? error.message : "Cloud invoice creation failed.");
    }
  });

  if (guard) return guard;

  function chooseCustomer(row: Customer) {
    setSelectedCustomerId(row.id);
    setCustomer({
      name: row.name || "",
      phone: row.phone || "",
      email: row.email || "",
      gstin: row.gstin || "",
      address: row.address || "",
      customerCode: row.customerCode || ""
    });
    setSelectedVehicleId("");
    setVehicle((current) => ({ ...current, registrationNumber: "", make: "", model: "", color: "" }));
  }

  function chooseVehicle(row: Vehicle) {
    setSelectedVehicleId(row.id);
    setVehicle({
      registrationNumber: String(row.registrationNumber || "").toUpperCase(),
      vehicleType: row.vehicleType || "car",
      make: row.make || "",
      model: row.model || "",
      color: row.color || ""
    });
  }

  function addService(service: ServiceItem) {
    setItems((current) => [
      ...current,
      {
        ...emptyItem(defaultGstRate),
        serviceId: service.id,
        description: service.name,
        unitPrice: numberValue(service.defaultPrice),
        gstRate: numberValue(service.gstRate || defaultGstRate),
        sacCode: normalizeSacCode(service.sacCode),
        ...warrantyFieldsFromService(service)
      }
    ]);
  }

  function addStockItem(item: InventoryItem) {
    setItems((current) => [
      ...current,
      {
        ...emptyItem(defaultGstRate),
        inventoryItemId: item.id,
        description: item.name,
        unitPrice: numberValue(item.retailPrice),
        gstRate: numberValue(item.gstRate || defaultGstRate),
        sacCode: DEFAULT_SAC_CODE
      }
    ]);
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  function buildPayload(): InvoiceCreateInput {
    return {
      invoiceMode,
      taxScope,
      invoiceDate,
      customerId: selectedCustomerId || undefined,
      customer: {
        id: selectedCustomerId || undefined,
        customerCode: customer.customerCode || undefined,
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: customer.email.trim(),
        gstin: customer.gstin.trim(),
        address: customer.address.trim()
      },
      vehicleId: selectedVehicleId || undefined,
      vehicle: {
        id: selectedVehicleId || undefined,
        customerId: selectedCustomerId || undefined,
        registrationNumber: vehicle.registrationNumber.trim().toUpperCase(),
        vehicleType: vehicle.vehicleType,
        make: vehicle.make.trim(),
        model: vehicle.model.trim(),
        color: vehicle.color.trim()
      },
      items: items.map(({ key: _key, ...item }) => ({
        ...item,
        description: item.description.trim(),
        quantity: money(numberValue(item.quantity)),
        unitPrice: money(numberValue(item.unitPrice)),
        gstRate: invoiceMode === "gst" ? money(numberValue(item.gstRate)) : 0,
        sacCode: normalizeSacCode(item.sacCode),
        warrantyIncluded: Boolean(item.warrantyIncluded && parseWarrantyDurationMonths(item.warrantyDurationMonths || item.warrantyText)),
        warrantyDurationMonths: parseWarrantyDurationMonths(item.warrantyDurationMonths || item.warrantyText),
        warrantyText: normalizeWarrantyText(item.warrantyText, parseWarrantyDurationMonths(item.warrantyDurationMonths || item.warrantyText))
      })),
      discount: money(discount),
      paidAmount: money(paidAmount),
      paymentMode,
      paymentReference: paymentReference.trim(),
      notes: notes.trim()
    };
  }

  function submit() {
    if (validationError) {
      Alert.alert("Check invoice", validationError);
      return;
    }
    createMutation.mutate();
  }

  return (
    <Screen
      title="Create Invoice"
      subtitle="Cloud invoice number and stock deduction happen only after submit."
      refreshing={settingsQuery.isFetching || customersQuery.isFetching || vehiclesQuery.isFetching || servicesQuery.isFetching || inventoryQuery.isFetching}
      onRefresh={() => {
        void settingsQuery.refetch();
        void customersQuery.refetch();
        void vehiclesQuery.refetch();
        void servicesQuery.refetch();
        void inventoryQuery.refetch();
      }}
      fixedFooter={
        <View style={styles.footer}>
          <View style={styles.footerTotals}>
            <Text style={styles.footerLabel}>Grand total</Text>
            <Text style={styles.footerValue}>{formatMoney(totals.grandTotal)}</Text>
          </View>
          <AppButton label={createMutation.isPending ? "Creating..." : "Create Invoice"} onPress={submit} loading={createMutation.isPending} disabled={Boolean(validationError)} />
        </View>
      }
    >
      {validationError ? <Text style={styles.error}>{validationError}</Text> : null}
      {settingsQuery.error || customersQuery.error || vehiclesQuery.error || servicesQuery.error || inventoryQuery.error ? (
        <Text style={styles.error}>Some billing data could not be loaded. Refresh before creating the invoice.</Text>
      ) : null}

      <Section title="Invoice Settings">
        <Segmented
          options={[
            { label: "GST", value: "gst" },
            { label: "Simple", value: "simple" }
          ]}
          value={invoiceMode}
          onChange={(value) => setInvoiceMode(value as InvoiceMode)}
        />
        <Segmented
          disabled={invoiceMode === "simple"}
          options={[
            { label: "Intra State", value: "intra" },
            { label: "Inter State", value: "inter" }
          ]}
          value={taxScope}
          onChange={(value) => setTaxScope(value as TaxScope)}
        />
        <Input label="Invoice date" value={invoiceDate} onChangeText={setInvoiceDate} placeholder="YYYY-MM-DD" />
      </Section>

      <Section title="Customer">
        {!canReadCustomers ? <Text style={styles.empty}>This role cannot browse saved customers. Enter customer details manually.</Text> : null}
        <Input label="Search existing customer" value={customerQuery} onChangeText={setCustomerQuery} placeholder="Name, phone, or customer ID" />
        {customerMatches.map((row) => (
          <SelectRow key={row.id} selected={selectedCustomerId === row.id} title={`${row.customerCode || "Customer"} - ${row.name}`} subtitle={row.phone || row.email} onPress={() => chooseCustomer(row)} />
        ))}
        <View style={styles.twoColumn}>
          <Input label="Customer name" value={customer.name} onChangeText={(value) => setCustomer({ ...customer, name: value })} />
          <Input label="Phone" value={customer.phone} onChangeText={(value) => setCustomer({ ...customer, phone: value })} keyboardType="phone-pad" />
        </View>
        <Input label="Email" value={customer.email} onChangeText={(value) => setCustomer({ ...customer, email: value })} keyboardType="email-address" />
        <Input label="GSTIN" value={customer.gstin} onChangeText={(value) => setCustomer({ ...customer, gstin: value.toUpperCase() })} autoCapitalize="characters" />
        <Input label="Address" value={customer.address} onChangeText={(value) => setCustomer({ ...customer, address: value })} />
      </Section>

      <Section title="Vehicle">
        {!canReadVehicles ? <Text style={styles.empty}>This role cannot browse saved vehicles. Enter vehicle details manually.</Text> : null}
        {vehicleOptions.map((row) => (
          <SelectRow
            key={row.id}
            selected={selectedVehicleId === row.id}
            title={row.registrationNumber || "Vehicle"}
            subtitle={[titleCase(row.vehicleType), row.make, row.model, row.color].filter(Boolean).join(" ")}
            onPress={() => chooseVehicle(row)}
          />
        ))}
        <Segmented options={VEHICLE_TYPES.map((type) => ({ label: titleCase(type), value: type }))} value={vehicle.vehicleType} onChange={(value) => setVehicle({ ...vehicle, vehicleType: value as VehicleType })} />
        <View style={styles.twoColumn}>
          <Input label="Vehicle number" value={vehicle.registrationNumber} onChangeText={(value) => setVehicle({ ...vehicle, registrationNumber: value.toUpperCase() })} autoCapitalize="characters" />
          <Input label="Make" value={vehicle.make} onChangeText={(value) => setVehicle({ ...vehicle, make: value })} />
        </View>
        <View style={styles.twoColumn}>
          <Input label="Model" value={vehicle.model} onChangeText={(value) => setVehicle({ ...vehicle, model: value })} />
          <Input label="Color" value={vehicle.color} onChangeText={(value) => setVehicle({ ...vehicle, color: value })} />
        </View>
      </Section>

      <Section title="Add Services">
        {!canReadServices ? <Text style={styles.empty}>This role cannot browse saved services. Add a custom line instead.</Text> : null}
        <Input label="Search services" value={serviceQuery} onChangeText={setServiceQuery} placeholder="Service name" />
        {serviceMatches.map((service) => (
          <SelectRow
            key={service.id}
            title={service.name}
            subtitle={`${formatMoney(service.defaultPrice)} | GST ${service.gstRate || defaultGstRate}%${service.warrantyEnabled ? ` | Warranty ${warrantyDurationLabel(service.warrantyDurationMonths)}` : ""}`}
            actionLabel="Add"
            onPress={() => addService(service)}
          />
        ))}
      </Section>

      <Section title="Add Retail Stock">
        {!canReadStock ? <Text style={styles.empty}>This role cannot browse retail stock. Add a custom line instead.</Text> : null}
        <Input label="Search retail items" value={stockQuery} onChangeText={setStockQuery} placeholder="Product name or SKU" />
        {stockMatches.map((item) => (
          <SelectRow
            key={item.id}
            title={item.name}
            subtitle={`${formatMoney(item.retailPrice)} | Stock ${item.currentQuantity || 0} ${item.unit || "unit"}`}
            actionLabel="Add"
            onPress={() => addStockItem(item)}
          />
        ))}
        <AppButton label="Add custom line" variant="secondary" onPress={() => setItems((current) => [...current, emptyItem(defaultGstRate)])} />
      </Section>

      <Section title="Items">
        {items.map((item, index) => (
          <View key={item.key} style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle}>Item {index + 1}</Text>
              <AppButton label="Remove" variant="danger" onPress={() => removeItem(item.key)} style={styles.smallButton} />
            </View>
            <Input label="Description" value={item.description} onChangeText={(value) => updateItem(item.key, { description: value })} />
            <View style={styles.twoColumn}>
              <Input label="Quantity" value={String(item.quantity || 0)} keyboardType="decimal-pad" onChangeText={(value) => updateItem(item.key, { quantity: numberValue(value) })} />
              <Input label="Unit price" value={String(item.unitPrice || 0)} keyboardType="decimal-pad" onChangeText={(value) => updateItem(item.key, { unitPrice: numberValue(value) })} />
            </View>
            <View style={styles.twoColumn}>
              <Input label="GST %" value={String(item.gstRate || 0)} keyboardType="decimal-pad" onChangeText={(value) => updateItem(item.key, { gstRate: numberValue(value) })} />
              <Input label="SAC" value={item.sacCode || DEFAULT_SAC_CODE} keyboardType="number-pad" onChangeText={(value) => updateItem(item.key, { sacCode: value })} />
            </View>
            {parseWarrantyDurationMonths(item.warrantyDurationMonths || item.warrantyText) ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: Boolean(item.warrantyIncluded) }}
                onPress={() => updateItem(item.key, { warrantyIncluded: !item.warrantyIncluded })}
                style={styles.toggleRow}
              >
                <Text style={styles.toggleText}>
                  Warranty {item.warrantyIncluded ? "included" : "removed"} - {warrantyDurationLabel(parseWarrantyDurationMonths(item.warrantyDurationMonths || item.warrantyText))}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {!items.length ? <Text style={styles.empty}>Add a service, retail stock item, or custom line.</Text> : null}
      </Section>

      <Section title="Totals & Payment">
        <MetricGrid>
          <MetricCard label="Subtotal" value={formatMoney(totals.subTotal)} />
          <MetricCard label="Tax" value={formatMoney(totals.totalTax)} />
          <MetricCard label="Grand Total" value={formatMoney(totals.grandTotal)} tone="success" />
        </MetricGrid>
        <View style={styles.twoColumn}>
          <Input label="Discount" value={String(discount || 0)} keyboardType="decimal-pad" onChangeText={(value) => setDiscount(numberValue(value))} />
          <Input label="Paid amount" value={String(paidAmount || 0)} keyboardType="decimal-pad" onChangeText={(value) => setPaidAmount(numberValue(value))} />
        </View>
        <Segmented options={PAYMENT_MODES.map((mode) => ({ label: mode, value: mode }))} value={paymentMode} onChange={(value) => setPaymentMode(value as PaymentMode)} />
        <Input label="Payment reference" value={paymentReference} onChangeText={setPaymentReference} />
        <Input label="Notes" value={notes} onChangeText={setNotes} />
      </Section>
    </Screen>
  );
}

function filterCustomers(rows: Customer[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((row) => [row.customerCode, row.name, row.phone, row.email].some((value) => String(value || "").toLowerCase().includes(needle)))
    : rows;
  return filtered.slice(0, 6);
}

function filterServices(rows: ServiceItem[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => [row.name, row.category].some((value) => String(value || "").toLowerCase().includes(needle))) : rows;
  return filtered.slice(0, 8);
}

function filterStock(rows: InventoryItem[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => [row.name, row.sku, row.category].some((value) => String(value || "").toLowerCase().includes(needle))) : rows;
  return filtered.slice(0, 8);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  autoCapitalize = "none"
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad" | "decimal-pad" | "phone-pad" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
  disabled = false
}: {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segmented, disabled ? styles.disabled : null]}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => onChange(option.value)}
          style={[styles.segment, value === option.value ? styles.segmentActive : null]}
        >
          <Text style={[styles.segmentText, value === option.value ? styles.segmentTextActive : null]} numberOfLines={1}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SelectRow({
  title,
  subtitle,
  selected = false,
  actionLabel,
  onPress
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  actionLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.selectRow, selected ? styles.selectRowSelected : null, pressed ? styles.pressed : null]}>
      <View style={styles.selectText}>
        <Text style={styles.selectTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.selectSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={styles.selectAction}>{selected ? "Selected" : actionLabel || "Use"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  inputWrap: {
    flex: 1,
    minWidth: 132,
    gap: 6
  },
  inputLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800"
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    paddingHorizontal: 12
  },
  twoColumn: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  segmented: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  segment: {
    minHeight: 42,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 10
  },
  segmentActive: {
    borderColor: colors.primary,
    backgroundColor: colors.chip
  },
  segmentText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: colors.primaryDark
  },
  selectRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 10
  },
  selectRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.chip
  },
  selectText: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  selectTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  selectSub: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  selectAction: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900"
  },
  itemCard: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    padding: 10
  },
  itemHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  itemTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  smallButton: {
    minHeight: 40,
    minWidth: 96
  },
  toggleRow: {
    minHeight: 42,
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 10
  },
  toggleText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "900"
  },
  footer: {
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceStrong,
    padding: 12
  },
  footerTotals: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  footerLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  footerValue: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: "900"
  },
  pressed: {
    transform: [{ scale: 0.99 }]
  },
  disabled: {
    opacity: 0.55
  },
  empty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  }
});
