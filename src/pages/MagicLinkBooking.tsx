import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Sparkles,
  Activity,
  Hand,
  Eye,
  Scissors,
  PenTool,
  Stethoscope,
  Waves,
  Palette,
  MessageCircle,
  User,
  ShoppingCart,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Check
} from 'lucide-react';

// Mock Services Data - Simulating Database
const MOCK_SERVICES = [
  {
    id: 1,
    name: 'Lazer Epilasyon - Kol',
    duration: 30,
    price: 200,
    targetGender: 'FEMALE',
    isSynergyEnabled: true,
    categoryId: 1,
    category: {
      name: 'Epilasyon & Tüy Alma',
      schedulingRule: 'CONSECUTIVE_BLOCK',
      synergyFactor: 0.3,
      icon: Zap
    }
  },
  {
    id: 2,
    name: 'Lazer Epilasyon - Bacak',
    duration: 45,
    price: 300,
    targetGender: 'FEMALE',
    isSynergyEnabled: true,
    categoryId: 1,
    category: {
      name: 'Epilasyon & Tüy Alma',
      schedulingRule: 'CONSECUTIVE_BLOCK',
      synergyFactor: 0.3,
      icon: Zap
    }
  },
  {
    id: 3,
    name: 'Lazer Epilasyon - Sırt',
    duration: 40,
    price: 250,
    targetGender: 'MALE',
    isSynergyEnabled: true,
    categoryId: 1,
    category: {
      name: 'Epilasyon & Tüy Alma',
      schedulingRule: 'CONSECUTIVE_BLOCK',
      synergyFactor: 0.3,
      icon: Zap
    }
  },
  {
    id: 4,
    name: 'Hydrafacial',
    duration: 60,
    price: 400,
    targetGender: 'UNISEX',
    isSynergyEnabled: false,
    categoryId: 2,
    category: {
      name: 'Cilt Sağlığı & Yüz',
      schedulingRule: 'ROOM_DEPENDENT',
      synergyFactor: 0.8,
      icon: Sparkles
    }
  },
  {
    id: 5,
    name: 'Kavitasyon',
    duration: 60,
    price: 500,
    targetGender: 'FEMALE',
    isSynergyEnabled: false,
    categoryId: 3,
    category: {
      name: 'Vücut Şekillendirme',
      schedulingRule: 'ROOM_DEPENDENT',
      synergyFactor: 0.5,
      icon: Activity
    }
  },
  {
    id: 6,
    name: 'Manikür',
    duration: 45,
    price: 120,
    targetGender: 'FEMALE',
    isSynergyEnabled: false,
    categoryId: 4,
    category: {
      name: 'Tırnak & El/Ayak',
      schedulingRule: 'PARALLEL_POSSIBLE',
      synergyFactor: 1.0,
      icon: Hand
    }
  },
  {
    id: 7,
    name: 'Kaş Mikroblad',
    duration: 90,
    price: 600,
    targetGender: 'FEMALE',
    isSynergyEnabled: false,
    categoryId: 5,
    category: {
      name: 'Bakış Tasarımı (Kaş/Kirpik)',
      schedulingRule: 'STANDARD',
      synergyFactor: 0.9,
      icon: Eye
    }
  },
  {
    id: 8,
    name: 'Saç Kesimi',
    duration: 45,
    price: 100,
    targetGender: 'UNISEX',
    isSynergyEnabled: false,
    categoryId: 6,
    category: {
      name: 'Saç Tasarımı',
      schedulingRule: 'FLEXIBLE_FLOW',
      synergyFactor: 1.0,
      icon: Scissors
    }
  },
  {
    id: 9,
    name: 'Kalıcı Kaş',
    duration: 120,
    price: 800,
    targetGender: 'FEMALE',
    isSynergyEnabled: false,
    categoryId: 7,
    category: {
      name: 'Kalıcı Makyaj (PMU)',
      schedulingRule: 'STANDARD',
      synergyFactor: 1.0,
      icon: PenTool
    }
  },
  {
    id: 10,
    name: 'Botox',
    duration: 30,
    price: 800,
    targetGender: 'UNISEX',
    isSynergyEnabled: false,
    categoryId: 8,
    category: {
      name: 'Medikal Estetik',
      schedulingRule: 'ROOM_DEPENDENT',
      synergyFactor: 0.9,
      icon: Stethoscope
    }
  },
  {
    id: 11,
    name: 'Spa Masajı',
    duration: 90,
    price: 300,
    targetGender: 'UNISEX',
    isSynergyEnabled: false,
    categoryId: 9,
    category: {
      name: 'Spa & Wellness',
      schedulingRule: 'STRICT_BLOCK_BUFFERED',
      synergyFactor: 1.0,
      icon: Waves
    }
  },
  {
    id: 12,
    name: 'Gelin Makyajı',
    duration: 120,
    price: 800,
    targetGender: 'FEMALE',
    isSynergyEnabled: false,
    categoryId: 10,
    category: {
      name: 'Profesyonel Makyaj',
      schedulingRule: 'STANDARD',
      synergyFactor: 1.0,
      icon: Palette
    }
  },
  {
    id: 13,
    name: 'Cilt Analizi Danışmanlığı',
    duration: 30,
    price: 100,
    targetGender: 'UNISEX',
    isSynergyEnabled: false,
    categoryId: 11,
    category: {
      name: 'Danışmanlık',
      schedulingRule: 'STANDARD',
      synergyFactor: 1.0,
      icon: MessageCircle
    }
  }
];

// Mock Staff Data
const MOCK_STAFF = [
  { id: 1, name: 'Ayşe Yılmaz' },
  { id: 2, name: 'Mehmet Kaya' },
  { id: 3, name: 'Zeynep Demir' },
  { id: 4, name: 'Ahmet Çelik' }
];

const MagicLinkBooking: React.FC = () => {
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [selectedGender, setSelectedGender] = useState<'FEMALE' | 'MALE' | null>(null);
  const [userName, setUserName] = useState('Misafir');
  const [cart, setCart] = useState<Array<{
    serviceId: number;
    service: any;
    staffId: number;
    isGift: boolean;
  }>>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());

  // Gender Intelligence Engine
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const uid = urlParams.get('uid');

    // Check URL for user profile
    if (uid) {
      // Mock: Assume user profile from DB
      const mockUserGender = uid.startsWith('male') ? 'MALE' : 'FEMALE';
      setSelectedGender(mockUserGender);
      setUserName(mockUserGender === 'MALE' ? 'Ahmet Bey' : 'Ayşe Hanım');
      return;
    }

    // Check localStorage
    const storedGender = localStorage.getItem('preferredGender') as 'FEMALE' | 'MALE' | null;
    if (storedGender) {
      setSelectedGender(storedGender);
      setUserName(storedGender === 'MALE' ? 'Beyefendi' : 'Hanımefendi');
      return;
    }

    // Show welcome modal
    setShowWelcomeModal(true);
  }, []);

  const handleGenderSelect = (gender: 'FEMALE' | 'MALE') => {
    setSelectedGender(gender);
    setUserName(gender === 'MALE' ? 'Beyefendi' : 'Hanımefendi');
    localStorage.setItem('preferredGender', gender);
    setShowWelcomeModal(false);
  };

  const toggleCategory = (categoryId: number) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const addToCart = (service: any) => {
    if (!cart.find(item => item.serviceId === service.id)) {
      setCart([...cart, {
        serviceId: service.id,
        service,
        staffId: MOCK_STAFF[0].id, // Default staff
        isGift: false
      }]);
    }
  };

  const removeFromCart = (serviceId: number) => {
    setCart(cart.filter(item => item.serviceId !== serviceId));
  };

  const updateCartItem = (serviceId: number, updates: Partial<typeof cart[0]>) => {
    setCart(cart.map(item =>
      item.serviceId === serviceId ? { ...item, ...updates } : item
    ));
  };

  // Filter services based on selected gender
  const filteredServices = selectedGender
    ? MOCK_SERVICES.filter(service =>
        service.targetGender === selectedGender || service.targetGender === 'UNISEX'
      )
    : MOCK_SERVICES;

  // Group services by category
  const servicesByCategory = filteredServices.reduce((acc, service) => {
    const categoryId = service.categoryId;
    if (!acc[categoryId]) {
      acc[categoryId] = {
        ...service.category,
        id: categoryId,
        services: []
      };
    }
    acc[categoryId].services.push(service);
    return acc;
  }, {} as Record<number, any>);

  const totalPrice = cart.reduce((sum, item) => sum + item.service.price, 0);
  const totalDuration = cart.reduce((sum, item) => sum + item.service.duration, 0);

  if (!selectedGender) {
    return null; // Loading state
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Welcome Modal */}
      <AnimatePresence>
        {showWelcomeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white/90 backdrop-blur-md rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl border border-gray-200"
            >
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  SalonAsistan'a Hoş Geldiniz
                </h2>
                <p className="text-gray-600 mb-8">
                  Lütfen hizmet menünüzü seçin:
                </p>

                <div className="space-y-4">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleGenderSelect('FEMALE')}
                    className="w-full bg-gradient-to-r from-pink-100 to-pink-200 hover:from-pink-200 hover:to-pink-300 text-pink-800 font-semibold py-4 px-6 rounded-xl border border-pink-300 transition-all duration-200"
                  >
                    👩 Kadın Hizmetleri
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleGenderSelect('MALE')}
                    className="w-full bg-gradient-to-r from-blue-100 to-blue-200 hover:from-blue-200 hover:to-blue-300 text-blue-800 font-semibold py-4 px-6 rounded-xl border border-blue-300 transition-all duration-200"
                  >
                    👨 Erkek Hizmetleri
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="pb-24">
        {/* Sticky Header */}
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200"
        >
          <div className="px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-[#D4AF37] to-yellow-600 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="font-semibold text-gray-900">Merhaba, {userName}</h1>
                  <p className="text-sm text-gray-600">Hizmetlerinizi seçin</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <ShoppingCart className="w-5 h-5 text-gray-600" />
                <span className="bg-[#D4AF37] text-white text-xs font-bold px-2 py-1 rounded-full">
                  {cart.length}
                </span>
              </div>
            </div>

            {/* Gender Toggle */}
            <div className="bg-gray-100 rounded-xl p-1 flex">
              <motion.div
                animate={{
                  x: selectedGender === 'FEMALE' ? 0 : '100%'
                }}
                className="absolute w-1/2 h-8 bg-[#D4AF37] rounded-lg"
                style={{ marginTop: '2px', marginLeft: '2px' }}
              />
              <button
                onClick={() => setSelectedGender('FEMALE')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-colors relative z-10 ${
                  selectedGender === 'FEMALE' ? 'text-white' : 'text-gray-600'
                }`}
              >
                👩 Kadın
              </button>
              <button
                onClick={() => setSelectedGender('MALE')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-colors relative z-10 ${
                  selectedGender === 'MALE' ? 'text-white' : 'text-gray-600'
                }`}
              >
                👨 Erkek
              </button>
            </div>
          </div>
        </motion.div>

        {/* Service Categories */}
        <div className="px-4 py-6 space-y-4">
          {Object.values(servicesByCategory).map((category: any, index) => {
            const IconComponent = category.icon;
            const isExpanded = expandedCategories.has(category.id);

            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
              >
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-[#D4AF37]/10 rounded-lg flex items-center justify-center">
                      <IconComponent className="w-5 h-5 text-[#D4AF37]" />
                    </div>
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900">{category.name}</h3>
                      <p className="text-sm text-gray-600">{category.services.length} hizmet</p>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-600" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-600" />
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-gray-100"
                    >
                      <div className="p-4 space-y-3">
                        {category.services.map((service: any) => {
                          const isInCart = cart.some(item => item.serviceId === service.id);
                          const cartItem = cart.find(item => item.serviceId === service.id);

                          return (
                            <motion.div
                              key={service.id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="bg-gray-50 rounded-lg p-3"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <h4 className="font-medium text-gray-900">{service.name}</h4>
                                    {service.category.schedulingRule === 'CONSECUTIVE_BLOCK' && (
                                      <motion.span
                                        animate={{ scale: [1, 1.1, 1] }}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        className="bg-[#D4AF37] text-white text-xs px-2 py-1 rounded-full font-medium"
                                      >
                                        ⚡ Akıllı Blok
                                      </motion.span>
                                    )}
                                  </div>
                                  <div className="flex items-center space-x-3 text-sm text-gray-600">
                                    <div className="flex items-center space-x-1">
                                      <Clock className="w-4 h-4" />
                                      <span>{service.duration}dk</span>
                                    </div>
                                    <span>₺{service.price}</span>
                                  </div>
                                </div>

                                {!isInCart ? (
                                  <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => addToCart(service)}
                                    className="bg-[#D4AF37] text-white px-4 py-2 rounded-lg font-medium text-sm"
                                  >
                                    Ekle
                                  </motion.button>
                                ) : (
                                  <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => removeFromCart(service.id)}
                                    className="bg-red-500 text-white px-4 py-2 rounded-lg font-medium text-sm"
                                  >
                                    <X className="w-4 h-4" />
                                  </motion.button>
                                )}
                              </div>

                              {/* Expanded Cart Item */}
                              <AnimatePresence>
                                {isInCart && cartItem && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="mt-3 pt-3 border-t border-gray-200 space-y-3"
                                  >
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Uzman Seçin
                                      </label>
                                      <select
                                        value={cartItem.staffId}
                                        onChange={(e) => updateCartItem(service.id, { staffId: parseInt(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent"
                                      >
                                        {MOCK_STAFF.map(staff => (
                                          <option key={staff.id} value={staff.id}>
                                            {staff.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="flex items-center space-x-3">
                                      <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`gift-${service.id}`}
                                          checked={!cartItem.isGift}
                                          onChange={() => updateCartItem(service.id, { isGift: false })}
                                          className="text-[#D4AF37] focus:ring-[#D4AF37]"
                                        />
                                        <span className="text-sm text-gray-700">Kendim için</span>
                                      </label>
                                      <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`gift-${service.id}`}
                                          checked={cartItem.isGift}
                                          onChange={() => updateCartItem(service.id, { isGift: true })}
                                          className="text-[#D4AF37] focus:ring-[#D4AF37]"
                                        />
                                        <span className="text-sm text-gray-700">Hediye</span>
                                      </label>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Sticky Footer */}
      {cart.length > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-200 px-4 py-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-semibold text-gray-900">
                {cart.length} hizmet seçildi
              </p>
              <p className="text-sm text-gray-600">
                Toplam: {totalDuration}dk • ₺{totalPrice}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Tahmini süre</p>
              <p className="font-medium text-gray-900">{totalDuration} dakika</p>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full bg-gradient-to-r from-[#D4AF37] to-yellow-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg"
          >
            Randevuyu Onayla →
          </motion.button>
        </motion.div>
      )}
    </div>
  );
};

export default MagicLinkBooking;