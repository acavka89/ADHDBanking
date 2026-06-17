export function mergeRemoteSnapshot(current, snapshot) {
  const accounts = snapshot.accounts.length
    ? snapshot.accounts.map((account) => ({
      id: account.id,
      name: account.account_name,
      institution: account.account_type || 'Bank',
      purpose: /joint|halifax|household/i.test(`${account.account_name} ${account.account_type}`) ? 'household' : 'personal',
      balance: Number(account.available_balance ?? account.current_balance ?? 0),
      includeInSafeSpend: true,
    }))
    : current.accounts;

  const profile = snapshot.profile ? {
    ...current.profile,
    displayName: snapshot.profile.display_name || current.profile.displayName,
    payday: snapshot.profile.next_payday || current.profile.payday,
    monthlyIncome: Number(snapshot.profile.monthly_income || current.profile.monthlyIncome),
    expectedFoodTravel: Number(snapshot.profile.expected_food_travel || current.profile.expectedFoodTravel),
    debtMinimums: Number(snapshot.profile.debt_minimums || current.profile.debtMinimums),
    emergencyBuffer: Number(snapshot.profile.emergency_buffer || current.profile.emergencyBuffer),
    forgottenCostBuffer: Number(snapshot.profile.forgotten_cost_buffer || current.profile.forgottenCostBuffer),
    savingsGoal: Number(snapshot.profile.savings_goal || current.profile.savingsGoal),
    currentSavings: Number(snapshot.profile.current_savings || current.profile.currentSavings),
    bankConnected: snapshot.accounts.length > 0 || current.profile.bankConnected,
    trading212Connected: snapshot.positions.length > 0 || current.profile.trading212Connected,
  } : current.profile;

  const transactions = snapshot.transactions.length
    ? snapshot.transactions.map((tx) => ({
      id: tx.id,
      accountId: tx.account_id,
      merchant: tx.merchant_name,
      category: tx.category || 'Other',
      classification: tx.user_classification || 'Planned',
      amount: Number(tx.amount),
      date: tx.transaction_date,
      type: Number(tx.amount) > 0 ? 'income' : tx.category === 'Savings' ? 'invest' : tx.category === 'Bills' || tx.category === 'Housing' ? 'bill' : 'spend',
    }))
    : current.transactions;

  const recurring = snapshot.recurring.length
    ? snapshot.recurring.map((item) => ({
      id: item.id,
      merchant: item.merchant_name,
      amount: Number(item.average_amount),
      nextDate: item.next_expected_date,
      status: item.essential_status || 'Not sure',
      active: item.active,
    }))
    : current.recurring;

  const opportunities = snapshot.opportunities.length
    ? snapshot.opportunities.map((item) => ({
      id: item.id,
      type: item.opportunity_type,
      merchant: item.merchant_name,
      saving: Number(item.estimated_monthly_saving),
      confidence: item.confidence_score,
      prompt: 'Review this possible saving when you have a minute.',
      response: item.user_response,
    }))
    : current.opportunities;

  const goals = snapshot.positions.length
    ? [
      ...current.goals,
      {
        id: 'trading212-total',
        name: 'Trading 212 portfolio',
        target: snapshot.positions.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.current_price || 0), 0),
        current: snapshot.investmentAccounts.reduce((sum, item) => sum + Number(item.cash_balance || 0), 0),
        priority: 'Info',
      },
    ].filter((goal, index, all) => all.findIndex((candidate) => candidate.id === goal.id) === index)
    : current.goals;

  return { ...current, profile, accounts, transactions, recurring, opportunities, goals };
}
