import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module.js';
import { FoodLabelsController } from './food-labels.controller.js';
import { FoodLabelsService } from './food-labels.service.js';

/** Food items, the labels made for them, and what is in the fridge now. */
@Module({
  imports: [PdfModule],
  controllers: [FoodLabelsController],
  providers: [FoodLabelsService],
  exports: [FoodLabelsService],
})
export class FoodLabelsModule {}
