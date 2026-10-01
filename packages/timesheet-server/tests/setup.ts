import path from "node:path";
import { fileURLToPath } from "node:url";

// 从仓库根 .env.local 加载测试连接串等环境变量
const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env.local",
);
try {
  process.loadEnvFile(rootEnv);
} catch {
  // 无 .env.local 时按未配置处理(集成测试跳过)
}
