import { ChainBlock, ServiceInfo, IndexedData } from './types.js';

export type ServicePermutation = {
  blocks: ChainBlock[];
};

export class PermutationPruner {
  async *generateValidPermutations(
    serviceIds: number[],
    data: IndexedData
  ): AsyncGenerator<ServicePermutation> {
    // 1. Build Sequential Blocks
    const blocks = this.buildSequentialBlocks(serviceIds, data);
    
    // 2. Since we preserved UI order and handled sequential blocks deterministically,
    // we actually only have ONE permutation of blocks.
    // The "Permutation Explosion" was mainly due to reordering or trying all staff combinations.
    // Here we handle staff allocation later in ChainBuilder (finding valid staff).
    // So we just yield the single block sequence.
    
    // Wait, do we need to permute staff assignments here?
    // The plan said "Branch & prune approach".
    // "Zincir kurarken rule ihlali varsa branch anında kes."
    // This logic is actually inside ChainBuilder which tries to place blocks.
    
    // However, if we had "Any Order" services, we would need permutations here.
    // But requirement says: "Hizmetler sepetteki sıraya göre ardışık olmalı."
    // So order is fixed.
    
    // So effectively, we have 1 sequence of blocks.
    
    yield { blocks };
  }

  private buildSequentialBlocks(serviceIds: number[], data: IndexedData): ChainBlock[] {
    const blocks: ChainBlock[] = [];
    let currentSequentialBlock: ServiceInfo[] = [];
    let currentCategoryId: number | null = null;
    
    // Iterate services in UI order
    for (const serviceId of serviceIds) {
      const service = data.servicesById.get(serviceId);
      if (!service) continue;

      const category = service.categoryId ? data.categoriesById.get(service.categoryId) : undefined;
      const isSequential = category?.sequentialRequired === true;
      
      if (isSequential) {
        if (currentCategoryId === service.categoryId) {
          // Continue sequence
          currentSequentialBlock.push(service);
        } else {
          // Finish previous sequence
          if (currentSequentialBlock.length > 0) {
            blocks.push({
              type: 'sequential',
              services: [...currentSequentialBlock],
              categoryId: currentCategoryId
            });
          }
          // Start new sequence
          currentSequentialBlock = [service];
          currentCategoryId = service.categoryId;
        }
      } else {
        // Finish any pending sequence
        if (currentSequentialBlock.length > 0) {
          blocks.push({
            type: 'sequential',
            services: [...currentSequentialBlock],
            categoryId: currentCategoryId
          });
          currentSequentialBlock = [];
          currentCategoryId = null;
        }
        
        // Add individual block
        blocks.push({
          type: 'individual',
          services: [service],
          categoryId: service.categoryId
        });
      }
    }
    
    // Finish remaining
    if (currentSequentialBlock.length > 0) {
      blocks.push({
        type: 'sequential',
        services: currentSequentialBlock,
        categoryId: currentCategoryId
      });
    }
    
    return blocks;
  }
}
