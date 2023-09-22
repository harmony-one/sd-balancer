import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppService, IOperationReq, OPERATION_TYPE, OPERATION_STATUS } from './app.service';

export class CreateOperationDto implements IOperationReq {
  type: OPERATION_TYPE;
  model?: string;
  lora?: string;
  controlnet?: string;
}

export class CompleteOperationDto {
  status: OPERATION_STATUS.SUCCESS |
    OPERATION_STATUS.ERROR |
    OPERATION_STATUS.CANCELED_BY_CLIENT |
    OPERATION_STATUS.CANCELED_BY_BALANCER
}

@ApiTags('app')
@Controller()
export class AppController {
  constructor(
    private readonly configService: ConfigService,
    private readonly appService: AppService
  ) { }
  @Get('/version')
  getVersion() {
    return this.configService.get('version');
  }

  @Get('/config')
  getConfig() {
    return {};
  }

  @Post('/operations/:id/complete')
  completeOperation(@Param('id') id, @Body() completeOperationDto: CompleteOperationDto) {
    return this.appService.completeOperation(id, completeOperationDto.status);
  }

  @Post('/operations')
  addOperation(@Body() createOperationDto: CreateOperationDto) {
    return this.appService.addOperation(createOperationDto);
  }

  @Get('/operations/:id')
  operation(@Param('id') id) {
    return this.appService.getFullOperationById(id);
  }

  @Get('/servers')
  servers() {
    return this.appService.getServers();
  }

  @Get('/operations')
  operations() {
    return this.appService.getOperations();
  }

  @Get('/stats')
  stats() {
    return this.appService.getStats();
  }
}