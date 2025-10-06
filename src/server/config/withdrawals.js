const WITHDRAWAL_METHODS = {
  stars: {
    label: 'Telegram-звёзды',
    options: {
      'stars-15': { payoutLabel: '15 Stars', baseCost: 900, commission: 45 },
      'stars-25': { payoutLabel: '25 Stars', baseCost: 1500, commission: 75 },
      'stars-50': { payoutLabel: '50 Stars', baseCost: 3000, commission: 150 },
      'stars-100': { payoutLabel: '100 Stars', baseCost: 6000, commission: 300 }
    },
    fields: []
  },
  gcubes: {
    label: 'GCubes',
    options: {
      'gcubes-60': { payoutLabel: '60 GCubes', baseCost: 3000, commission: 50 },
      'gcubes-300': { payoutLabel: '300 GCubes', baseCost: 15000, commission: 50 },
      'gcubes-600': { payoutLabel: '600 GCubes', baseCost: 30000, commission: 50 }
    },
    fields: [
      { id: 'blockmanId', label: 'ID в Blockman Go', required: true, minLength: 3, maxLength: 64 },
      { id: 'blockmanNickname', label: 'Ник в Blockman Go', required: true, minLength: 3, maxLength: 64 }
    ]
  },
  rub: {
    label: 'Перевод ₽',
    options: {
      'rub-200': { payoutLabel: '200 ₽', baseCost: 7600, commission: 100 },
      'rub-500': { payoutLabel: '500 ₽', baseCost: 19000, commission: 250 },
      'rub-750': { payoutLabel: '750 ₽', baseCost: 28500, commission: 375 },
      'rub-1000': { payoutLabel: '1000 ₽', baseCost: 38000, commission: 500 },
      'rub-1500': { payoutLabel: '1500 ₽', baseCost: 57000, commission: 750 },
      'rub-2000': { payoutLabel: '2000 ₽', baseCost: 76000, commission: 1000 }
    },
    fields: [
      { id: 'payoutPhone', label: 'Номер для перевода', required: true, minLength: 7, maxLength: 32 }
    ]
  }
};

module.exports = { WITHDRAWAL_METHODS };
