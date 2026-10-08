#include <Wire.h>
#include "mpu6500.h"

bfs::Mpu6500 imu(&Wire, bfs::Mpu6500::I2C_ADDR_PRIM);  // 0x68

void setup()
{
  Serial.begin(115200);
  delay(1000);

  Wire.begin(21, 22);
  Wire.setClock(400000);

  Serial.println("Starting MPU6500...");

  if (!imu.Begin())
  {
    Serial.println("MPU6500 not detected!");
    Serial.println("Check wiring: SDA->GPIO21, SCL->GPIO22, AD0->GND");
    while (1) delay(100);
  }

  Serial.println("MPU6500 OK!");
}

void loop()
{
  if (imu.Read())
  {
    Serial.print("Accel X: "); Serial.print(imu.accel_x_mps2(), 2);
    Serial.print("  Y: ");     Serial.print(imu.accel_y_mps2(), 2);
    Serial.print("  Z: ");     Serial.print(imu.accel_z_mps2(), 2);

    Serial.print(" | Gyro X: "); Serial.print(imu.gyro_x_radps(), 2);
    Serial.print("  Y: ");       Serial.print(imu.gyro_y_radps(), 2);
    Serial.print("  Z: ");       Serial.println(imu.gyro_z_radps(), 2);
  }

  delay(100);
}
