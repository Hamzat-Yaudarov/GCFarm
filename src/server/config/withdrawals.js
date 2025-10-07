const WITHDRAWAL_METHODS = {
  stars: {
    label: 'Telegram-звёзды',
    options: {
      'stars-15': { payoutLabel: '15 Stars', baseCost: 1170, commission: 59 },
      'stars-25': { payoutLabel: '25 Stars', baseCost: 1950, commission: 98 },
      'stars-50': { payoutLabel: '50 Stars', baseCost: 3900, commission: 195 },
      'stars-100': { payoutLabel: '100 Stars', baseCost: 7800, commission: 390 }
    },
    fields: []
  },
  gcubes: {
    label: 'GCubes',
    options: {
      'gcubes-60': { payoutLabel: '60 GCubes', baseCost: 3900, commission: 65 },
      'gcubes-300': { payoutLabel: '300 GCubes', baseCost: 19500, commission: 65 },
      'gcubes-600': { payoutLabel: '600 GCubes', baseCost: 39000, commission: 65 }
    },
    fields: [
      { id: 'blockmanId', label: 'ID в Blockman Go', required: true, minLength: 3, maxLength: 64 },
      { id: 'blockmanNickname', label: 'Ник в Blockman Go', required: true, minLength: 3, maxLength: 64 }
    ]
  },
  rub: {
    label: 'Перевод ₽',
    options: {
      'rub-200': { payoutLabel: '200 ₽', baseCost: 9880, commission: 130 },
      'rub-500': { payoutLabel: '500 ₽', baseCost: 24700, commission: 325 },
      'rub-750': { payoutLabel: '750 ₽', baseCost: 37050, commission: 488 },
      'rub-1000': { payoutLabel: '1000 ₽', baseCost: 49400, commission: 650 },
      'rub-1500': { payoutLabel: '1500 ₽', baseCost: 74100, commission: 975 },
      'rub-2000': { payoutLabel: '2000 ₽', baseCost: 98800, commission: 1300 }
    },
    fields: [
      { id: 'payoutPhone', label: 'Номер для перевода', required: true, minLength: 7, maxLength: 32 }
    ]
  }
};

module.exports = { WITHDRAWAL_METHODS };
