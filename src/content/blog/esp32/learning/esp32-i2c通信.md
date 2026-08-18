---
title: ESP32——I2C通信
description: 简单记录一下 ESP-IDF 如何使用 I2C 与从设备通信
pubDate: '2026-08-18'
category: esp32
tags:
  - esp32
  - i2c
draft: false
pinned: false
---
### 前提条件

- 使用ESP-IDF 5.x/6.x 的新驱动 API

### 四个步骤

1. 初始化总线相关参数
2. 初始化从设备相关参数
3. 设备存在性验证
4. 通信

### 细节

#### 总线相关

总线主要关注如下几个项目
`I2C控制器编号`
`SDA 和 SCL 端口`
`是否启用内部上拉电阻`.

反应到配置上，用的结构体叫`i2c_master_bus_config_t`，确定配置后使用`i2c_new_master_bus` 初始化一个I2C 总线，该方法成功后获得操作总线的句柄`i2c_master_bus_handle_t`.

```cpp

static i2c_master_bus_handle_t bus_handle;

i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_PORT,
        .sda_io_num = I2C_SDA_GPIO,
        .scl_io_num = I2C_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };

i2c_new_master_bus(&bus_cfg, &bus_handle);
```

#### 从设备相关

从设备主要关注如下几个方面
`设备地址`
`通信速率`
`设备地址长度`

通过`i2c_device_config_t`结构体配置从设备，然后使用`i2c_master_bus_add_device` 注册设备。

```cpp
i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = DEVICE_ADDR,
        .scl_speed_hz = I2C_SPEED_HZ,
    };

i2c_master_bus_add_device(bus_handle,&dev_cfg,&dev_handle);
```

#### 数据传送

主机向从机发送数据很简单，以**字节**为单位发送，给定缓冲用的 uint8数组指针 xx_buf 和内容长度即可。
```cpp

// 写数据
i2c_master_transmit(dev_handle, tx_buf, tx_len, 1000);

// 读数据
i2c_master_receive(dev_handle, rx_buf, rx_len, 1000);

// 读寄存器 &reg 寄存器地址
i2c_master_transmit_receive(dev_handle, &reg, 1, rx_buf, rx_len, 1000);

// 存在性检查
i2c_master_probe(bus_handle, DEVICE_ADDR, 1000);
```

#### 设备资源释放

```cpp
i2c_master_bus_rm_device(i2c_master_dev_handle_t handle);
i2c_del_master_bus(i2c_master_bus_handle_t bus_handle);
```
