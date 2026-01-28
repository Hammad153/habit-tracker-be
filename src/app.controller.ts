import { Controller, Get, Res } from '@nestjs/common';
import { AppService } from './app.service';
import type { Response } from 'express';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('sw.js')
  getServiceWorker(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
      // dummy service worker
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', () => self.clients.claim());
`);
  }
}
