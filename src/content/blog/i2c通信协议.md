---
title: I2C通信协议
description: 一种简单的数据通信协议，广泛存在于各种现代传感器中
pubDate: '2026-08-10'
category: 电子
tags:
  - 协议
  - i2c
draft: false
pinned: false
---
### 一句话概括

I²C（Inter-Integrated Circuit）是飞利浦开发的同步、半双工、二线制串行总线，支持一主多从。

### 两根线

![[i2c_connect.svg]]

- **SDA**：数据线
- **SCL**：时钟线
- 两条线都需要上拉电阻

### 数据有效条件

![[i2c_SDA_SCL.svg]]

SDA 在 SCL 高电平期间必须保持稳定，主机通常在 SCL 上升沿采样 SDA：高电平为 1，低电平为 0。

SDA 只能在 SCL 低电平期间变化。

### START / STOP

![[i2cStartStop.svg]]

- SCL 为高电平时，SDA 由高变低：**START**，表示通信开始
- SCL 为高电平时，SDA 由低变高：**STOP**，表示通信结束

### 地址与 ACK

I²C 通信总是由主机发起。主机先发送 **7 位从设备地址 + R/W 位**，地址匹配的从设备在第 9 个时钟返回 **ACK**。

![[i2c-addr.svg]]

如果没有从设备应答，主机收到 NACK，通常表示地址不匹配、设备未连接或设备暂时无法响应。

### 常见寄存器读取流程

```text
START
→ 从机地址 + W
→ ACK
→ 寄存器地址
→ ACK
→ 重复 START
→ 从机地址 + R
→ ACK
→ 数据
→ NACK
→ STOP
```

### 样例

1. 向从设备 `0x50` 写入数据 `0xDE`

![[i2c-1786328013117.gif]]

2. 从设备 `0x50` 返回一个字节 `0x07`

读取最后一个字节后，主机发送 **NACK**，表示不再继续读取。

![[i2c-1786328211721.gif]]

3. 从设备 `0x50` 读取寄存器 `0x10` 返回一个字节 `0x07`

先向设备写入要读取的寄存器编号，然后再 start + read 一次
![[i2c-read-reg.gif]]




