import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config';
import { Web3Module } from 'nest-web3';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    Web3Module,
    PrometheusModule.register(),
    HttpModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
