import type { DateRangePreset, Expense, ExpenseInput, PaymentMode, ProfitReportData } from "../../../shared/types";

const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const money = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const formatMoney = (value: number) =>
  `Rs ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "summary-row strong" : "summary-row"}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export const emptyExpenseInput = (): ExpenseInput => ({
  expenseDate: todayLocal(),
  category: "General",
  amount: 0,
  paymentMode: "UPI",
  vendor: "",
  reference: "",
  notes: ""
});

export function ProfitReportView({
  preset,
  setPreset,
  profit,
  expenseForm,
  setExpenseForm,
  savingExpense,
  saveExpense,
  editExpense,
  deleteExpense
}: {
  preset: DateRangePreset;
  setPreset: (preset: DateRangePreset) => void;
  profit: ProfitReportData;
  expenseForm: ExpenseInput;
  setExpenseForm: (input: ExpenseInput) => void;
  savingExpense: boolean;
  saveExpense: () => void;
  editExpense: (expense: ExpenseInput) => void;
  deleteExpense: (expense: Expense) => void;
}) {
  return (
    <div className="page-grid">
      <div className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Expenses & Profit</h2>
            <p>{profit.rangeLabel}</p>
          </div>
          <div className="segmented">
            {(["7d", "30d", "90d", "all"] as DateRangePreset[]).map((item) => (
              <button key={item} className={preset === item ? "active" : ""} onClick={() => setPreset(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="metric-strip">
          <Metric label="Paid revenue" value={formatMoney(profit.paidRevenue)} />
          <Metric label="Stock cost" value={formatMoney(profit.stockCost)} tone={profit.stockCost ? "warn" : "ok"} />
          <Metric label="Expenses" value={formatMoney(profit.expenseTotal)} tone={profit.expenseTotal ? "warn" : "ok"} />
          <Metric label="Cash profit" value={formatMoney(profit.cashProfit)} tone={profit.cashProfit >= 0 ? "ok" : "warn"} />
          <Metric label="Margin" value={`${profit.profitMargin}%`} tone={profit.profitMargin >= 0 ? "ok" : "warn"} />
        </div>
      </div>

      <section className="panel wide-panel">
        <h2>Profit trend</h2>
        <ProfitTrendChart profit={profit} />
      </section>

      <section className="panel">
        <h2>Profit breakdown</h2>
        <div className="summary-rows">
          <Row label="Paid revenue" value={formatMoney(profit.paidRevenue)} />
          <Row label="Less stock cost" value={formatMoney(profit.stockCost)} />
          <Row label="Less expenses" value={formatMoney(profit.expenseTotal)} />
          <Row label="Cash profit" value={formatMoney(profit.cashProfit)} strong />
        </div>
      </section>

      <section className="panel">
        <h2>Expense categories</h2>
        <div className="profit-bars">
          {profit.expensesByCategory.map((item) => (
            <div className="profit-bar-row" key={item.category}>
              <span>{item.category}</span>
              <div><b style={{ width: `${Math.max(4, (item.amount / Math.max(1, profit.expenseTotal)) * 100)}%` }} /></div>
              <strong>{formatMoney(item.amount)}</strong>
            </div>
          ))}
          {!profit.expensesByCategory.length && <div className="empty-state subtle">No expenses in this range.</div>}
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>{expenseForm.id ? "Edit expense" : "Add expense"}</h2>
            <p>Owner-only manual expense entry used for cash-profit reporting.</p>
          </div>
          {expenseForm.id && <button className="ghost-button" onClick={() => setExpenseForm(emptyExpenseInput())}>New expense</button>}
        </div>
        <div className="form-grid four">
          <label>Date<input type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm({ ...expenseForm, expenseDate: event.currentTarget.value })} /></label>
          <label>Category<input value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.currentTarget.value })} /></label>
          <label>Amount<input type="number" min="0" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: Number(event.currentTarget.value) })} /></label>
          <label>Mode<select value={expenseForm.paymentMode} onChange={(event) => setExpenseForm({ ...expenseForm, paymentMode: event.currentTarget.value as PaymentMode })}>{paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
          <label>Vendor<input value={expenseForm.vendor || ""} onChange={(event) => setExpenseForm({ ...expenseForm, vendor: event.currentTarget.value })} /></label>
          <label>Reference<input value={expenseForm.reference || ""} onChange={(event) => setExpenseForm({ ...expenseForm, reference: event.currentTarget.value })} /></label>
          <label className="wide-input">Notes<textarea value={expenseForm.notes || ""} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.currentTarget.value })} /></label>
          <button className="primary-action align-bottom" disabled={savingExpense} onClick={saveExpense}>{savingExpense ? "Saving..." : "Save expense"}</button>
        </div>
      </section>

      <section className="panel wide-panel">
        <h2>Expense audit</h2>
        <ExpenseTable expenses={profit.expenses} editExpense={editExpense} deleteExpense={deleteExpense} />
      </section>
    </div>
  );
}

function ProfitTrendChart({ profit }: { profit: ProfitReportData }) {
  const maxValue = Math.max(
    1,
    ...profit.trend.map((item) => Math.max(item.paidRevenue, item.stockCost + item.expenses, Math.abs(item.cashProfit)))
  );
  if (!profit.trend.length) return <div className="empty-state subtle">No profit activity in this range.</div>;
  return (
    <div className="profit-trend">
      {profit.trend.map((item) => (
        <div className="profit-trend-day" key={item.date}>
          <div className="profit-trend-bars">
            <span className="profit-revenue" style={{ height: `${Math.max(4, (item.paidRevenue / maxValue) * 100)}%` }} />
            <span className="profit-cost" style={{ height: `${Math.max(4, ((item.stockCost + item.expenses) / maxValue) * 100)}%` }} />
            <span className={item.cashProfit >= 0 ? "profit-net" : "profit-net loss"} style={{ height: `${Math.max(4, (Math.abs(item.cashProfit) / maxValue) * 100)}%` }} />
          </div>
          <strong>{item.label}</strong>
          <small>{formatMoney(item.cashProfit)}</small>
        </div>
      ))}
    </div>
  );
}

function ExpenseTable({
  expenses,
  editExpense,
  deleteExpense
}: {
  expenses: Expense[];
  editExpense: (expense: ExpenseInput) => void;
  deleteExpense: (expense: Expense) => void;
}) {
  if (!expenses.length) return <div className="empty-state subtle">No expenses available.</div>;
  return (
    <table className="compact-table">
      <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Mode</th><th>Amount</th><th>Reference</th><th></th></tr></thead>
      <tbody>
        {expenses.map((expense) => (
          <tr key={expense.id}>
            <td>{expense.expenseDate}</td>
            <td>{expense.category}</td>
            <td>{expense.vendor || "-"}</td>
            <td>{expense.paymentMode}</td>
            <td>{formatMoney(expense.amount)}</td>
            <td>{expense.reference || expense.notes || "-"}</td>
            <td className="actions-cell">
              <button className="ghost-button small" onClick={() => editExpense(expense)}>Edit</button>
              <button className="ghost-button small danger-text" onClick={() => deleteExpense(expense)}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

