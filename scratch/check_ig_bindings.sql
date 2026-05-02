SELECT "id","salonId","channel","externalAccountId","isActive","updatedAt"
FROM "SalonChannelBinding"
WHERE "channel"='INSTAGRAM' AND "salonId" IN (2,8)
ORDER BY "externalAccountId","updatedAt" DESC;
