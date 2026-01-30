import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Universal Category Taxonomy...');

  // Clear existing categories to avoid duplication
  await (prisma as any).serviceCategory.deleteMany({});
  console.log('✅ Cleared existing categories');

  // Master Category Taxonomy with Scheduling Rules
  const categories = [
    {
      name: 'Epilasyon & Tüy Alma',
      schedulingRule: 'CONSECUTIVE_BLOCK' as const,
      synergyFactor: 0.3,
      bufferMinutes: 0,
      description: 'Lazer epilasyon ve geleneksel tüy alma hizmetleri',
      services: [
        { name: 'Lazer Epilasyon - Kol', duration: 30, price: 200, targetGender: 'FEMALE' as const, isSynergyEnabled: true },
        { name: 'Lazer Epilasyon - Bacak', duration: 45, price: 300, targetGender: 'FEMALE' as const, isSynergyEnabled: true },
        { name: 'Lazer Epilasyon - Sırt', duration: 40, price: 250, targetGender: 'MALE' as const, isSynergyEnabled: true },
        { name: 'Lazer Epilasyon - Göbek', duration: 35, price: 220, targetGender: 'UNISEX' as const, isSynergyEnabled: true },
        { name: 'Ağda - Kol', duration: 20, price: 80, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Ağda - Bacak', duration: 40, price: 150, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Cilt Sağlığı & Yüz',
      schedulingRule: 'ROOM_DEPENDENT' as const,
      synergyFactor: 0.8,
      bufferMinutes: 15,
      description: 'Cilt bakımı, peeling ve yüz tedavileri',
      services: [
        { name: 'Hydrafacial', duration: 60, price: 400, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Kimyasal Peeling', duration: 45, price: 350, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Mikrodermabrazyon', duration: 50, price: 300, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Lazer Tonlama', duration: 30, price: 250, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'PRP Yüz Gençleştirme', duration: 90, price: 800, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Vücut Şekillendirme',
      schedulingRule: 'ROOM_DEPENDENT' as const,
      synergyFactor: 0.5,
      bufferMinutes: 20,
      description: 'Vücut şekillendirme ve selülit tedavileri',
      services: [
        { name: 'Kavitasyon', duration: 60, price: 500, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'RF Vücut Şekillendirme', duration: 45, price: 400, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Lazer Lipoliz', duration: 90, price: 1200, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Selülit Masajı', duration: 50, price: 200, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Endermoloji', duration: 40, price: 300, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Tırnak & El/Ayak',
      schedulingRule: 'PARALLEL_POSSIBLE' as const,
      synergyFactor: 1.0,
      bufferMinutes: 5,
      description: 'Manikür, pedikür ve tırnak bakımı',
      services: [
        { name: 'Manikür', duration: 45, price: 120, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Pedikür', duration: 60, price: 150, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kalıcı Oje', duration: 90, price: 200, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Tırnak Protezi', duration: 120, price: 400, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'El Bakımı', duration: 30, price: 100, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Bakış Tasarımı (Kaş/Kirpik)',
      schedulingRule: 'STANDARD' as const,
      synergyFactor: 0.9,
      bufferMinutes: 0,
      description: 'Kaş ve kirpik tasarımı hizmetleri',
      services: [
        { name: 'Kaş Kalemi', duration: 30, price: 80, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kaş Mikroblad', duration: 90, price: 600, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kalıcı Kaş', duration: 120, price: 800, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kirpik Lifting', duration: 60, price: 250, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kirpik Ekimi', duration: 180, price: 1500, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Saç Tasarımı',
      schedulingRule: 'FLEXIBLE_FLOW' as const,
      synergyFactor: 1.0,
      bufferMinutes: 10,
      description: 'Saç kesimi, boyama ve bakım hizmetleri',
      services: [
        { name: 'Saç Kesimi', duration: 45, price: 100, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Saç Boyama', duration: 120, price: 300, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Saç Bakımı', duration: 60, price: 150, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Saç Düzleştirme', duration: 90, price: 250, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Saç Ekimi Danışmanlığı', duration: 30, price: 0, targetGender: 'MALE' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Kalıcı Makyaj (PMU)',
      schedulingRule: 'STANDARD' as const,
      synergyFactor: 1.0,
      bufferMinutes: 0,
      description: 'Kalıcı makyaj ve mikro pigmentasyon',
      services: [
        { name: 'Kalıcı Kaş', duration: 120, price: 800, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kalıcı Dudak', duration: 90, price: 700, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kalıcı Eyeliner', duration: 100, price: 600, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Kalıcı Göz Feneri', duration: 60, price: 400, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Medikal Estetik',
      schedulingRule: 'ROOM_DEPENDENT' as const,
      synergyFactor: 0.9,
      bufferMinutes: 30,
      description: 'Tıbbi estetik ve dermatolojik tedaviler',
      services: [
        { name: 'Botox', duration: 30, price: 800, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Dolgu', duration: 45, price: 1200, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Mezoterapi', duration: 60, price: 600, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Lazer Epilasyon', duration: 30, price: 250, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Kimyasal Peeling', duration: 45, price: 400, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Spa & Wellness',
      schedulingRule: 'STRICT_BLOCK_BUFFERED' as const,
      synergyFactor: 1.0,
      bufferMinutes: 15,
      description: 'Spa ve wellness hizmetleri',
      services: [
        { name: 'Spa Masajı', duration: 90, price: 300, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Aromaterapi', duration: 60, price: 250, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Hot Stone Masajı', duration: 75, price: 350, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Reflexoloji', duration: 45, price: 200, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Detoks Programı', duration: 120, price: 500, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Profesyonel Makyaj',
      schedulingRule: 'STANDARD' as const,
      synergyFactor: 1.0,
      bufferMinutes: 0,
      description: 'Profesyonel makyaj hizmetleri',
      services: [
        { name: 'Gelin Makyajı', duration: 120, price: 800, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Özel Gün Makyajı', duration: 90, price: 500, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Gündelik Makyaj', duration: 60, price: 300, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
        { name: 'Makyaj Eğitimi', duration: 180, price: 1000, targetGender: 'FEMALE' as const, isSynergyEnabled: false },
      ]
    },
    {
      name: 'Danışmanlık',
      schedulingRule: 'STANDARD' as const,
      synergyFactor: 1.0,
      bufferMinutes: 0,
      description: 'Danışmanlık ve eğitim hizmetleri',
      services: [
        { name: 'Cilt Analizi Danışmanlığı', duration: 30, price: 100, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Saç Analizi Danışmanlığı', duration: 45, price: 150, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Beslenme Danışmanlığı', duration: 60, price: 200, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
        { name: 'Güzellik Eğitimi', duration: 90, price: 400, targetGender: 'UNISEX' as const, isSynergyEnabled: false },
      ]
    }
  ];

  // Seed categories and services
  for (const categoryData of categories) {
    console.log(`📁 Creating category: ${categoryData.name}`);

    const category = await (prisma as any).serviceCategory.create({
      data: {
        name: categoryData.name,
        description: categoryData.description,
        schedulingRule: categoryData.schedulingRule,
        synergyFactor: categoryData.synergyFactor,
        bufferMinutes: categoryData.bufferMinutes,
      }
    });

    // Create services for this category
    for (const serviceData of categoryData.services) {
      await prisma.service.create({
        data: {
          name: serviceData.name,
          duration: serviceData.duration,
          price: serviceData.price,
          targetGender: serviceData.targetGender,
          isSynergyEnabled: serviceData.isSynergyEnabled,
          categoryId: category.id,
          salonId: 1, // Assuming salon ID 1 exists
        }
      });
    }

    console.log(`   ✅ Created ${categoryData.services.length} services`);
  }

  console.log('🎉 Universal Category Taxonomy seeding completed!');
  console.log('\n📊 Summary:');
  console.log(`- ${categories.length} master categories created`);
  console.log(`- ${categories.reduce((sum, cat) => sum + cat.services.length, 0)} services populated`);
  console.log('- Gender targeting applied to all services');
  console.log('- Scheduling rules configured per category');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });